import express from 'express';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { db, DB_PATH } from './src/db.js';
import { gerarReciboHTML, gerarEscPos, imprimirNaRede } from './src/print.js';
import { exportVendasSankhya, exportClientes } from './src/export.js';

// Carrega .env (Node 20.12+/21.7+). Silencioso se nao existir.
try { process.loadEnvFile(); } catch { /* sem .env, usa defaults */ }

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3322);
const ADMIN_PIN = String(process.env.ADMIN_PIN || '1234');
const EVENT_NAME = process.env.EVENT_NAME || 'Natural Tech - TRUE';
const RECEIPT_MODE = process.env.RECEIPT_MODE || 'browser';

const app = express();
app.use(express.json({ limit: '6mb' })); // 6mb: fotos de brinde vao como data URL
app.use(express.static(join(__dirname, 'public')));

// ---------- helpers ----------
const FORMAS = new Set(['credito', 'debito', 'pix', 'dinheiro']);

function cpfValido(cpf) {
  const c = String(cpf || '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== Number(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === Number(c[10]);
}

function exigirAdmin(req, res, next) {
  if (String(req.get('x-admin-pin') || '') === ADMIN_PIN) return next();
  return res.status(401).json({ erro: 'PIN de admin invalido.' });
}

class EstoqueInsuficiente extends Error {
  constructor(produto, disponivel) {
    super(`Estoque insuficiente: ${produto} (disponivel: ${disponivel})`);
    this.produto = produto; this.disponivel = disponivel;
  }
}

// ---------- statements ----------
const stmtClientePorCpf = db.prepare('SELECT * FROM clientes WHERE cpf = ?');
const stmtInserirCliente = db.prepare(
  `INSERT INTO clientes (cpf, nome, email, telefone) VALUES (@cpf, @nome, @email, @telefone)`);
const stmtAtualizarCliente = db.prepare(
  `UPDATE clientes SET nome=@nome, email=@email, telefone=@telefone, updated_at=datetime('now','localtime') WHERE id=@id`);
const stmtProduto = db.prepare('SELECT * FROM produtos WHERE id = ?');
const stmtBaixarEstoque = db.prepare(
  'UPDATE produtos SET estoque = estoque - @qtd, updated_at=datetime(\'now\',\'localtime\') WHERE id=@id AND estoque >= @qtd');
const stmtDevolverEstoque = db.prepare(
  'UPDATE produtos SET estoque = estoque + @qtd, updated_at=datetime(\'now\',\'localtime\') WHERE id=@id');
const stmtInserirPedido = db.prepare(`
  INSERT INTO pedidos (cliente_id, cliente_nome, cliente_cpf, operador, device, subtotal_centavos, desconto_centavos,
    total_centavos, forma_pagamento, pagamento_nsu, pagamento_bandeira, brinde_id, brinde_nome, observacao)
  VALUES (@cliente_id, @cliente_nome, @cliente_cpf, @operador, @device, @subtotal_centavos, @desconto_centavos,
    @total_centavos, @forma_pagamento, @pagamento_nsu, @pagamento_bandeira, @brinde_id, @brinde_nome, @observacao)`);
const stmtInserirItem = db.prepare(`
  INSERT INTO pedido_itens (pedido_id, produto_id, sku, nome, preco_unit_centavos, qtd, total_centavos)
  VALUES (@pedido_id, @produto_id, @sku, @nome, @preco_unit_centavos, @qtd, @total_centavos)`);
const stmtMov = db.prepare(`
  INSERT INTO movimentacoes_estoque (produto_id, delta, estoque_resultante, motivo, pedido_id, operador)
  VALUES (@produto_id, @delta, @estoque_resultante, @motivo, @pedido_id, @operador)`);
const stmtPedido = db.prepare('SELECT * FROM pedidos WHERE id = ?');
const stmtItensPedido = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id');
const stmtCliente = db.prepare('SELECT * FROM clientes WHERE id = ?');
// Brinde por faixa de ticket: a MAIOR faixa ativa que o total atingir (nao acumula).
const stmtBrindeParaTotal = db.prepare(
  'SELECT * FROM brindes WHERE ativo=1 AND min_centavos <= ? AND (max_centavos IS NULL OR max_centavos >= ?) ORDER BY min_centavos DESC LIMIT 1');

// ---------- transacao: criar pedido (atomico, a prova de venda dupla) ----------
const criarPedidoTx = db.transaction((dados) => {
  // 1. cliente (upsert por CPF)
  let clienteId = null;
  if (dados.cliente && dados.cliente.cpf) {
    const cpf = dados.cliente.cpf.replace(/\D/g, '');
    const existente = stmtClientePorCpf.get(cpf);
    const payload = {
      cpf,
      nome: dados.cliente.nome || '',
      email: dados.cliente.email || null,
      telefone: dados.cliente.telefone || null,
    };
    if (existente) {
      clienteId = existente.id;
      stmtAtualizarCliente.run({ ...payload, id: clienteId });
    } else {
      clienteId = stmtInserirCliente.run(payload).lastInsertRowid;
    }
  }

  // 2. primeira passada: precos do banco (nunca confiar no cliente) + subtotal
  const itensCalc = [];
  let subtotal = 0;
  for (const item of dados.itens) {
    const prod = stmtProduto.get(item.produto_id);
    if (!prod) throw new Error(`Produto ${item.produto_id} nao encontrado.`);
    const qtd = Math.trunc(Number(item.qtd));
    if (!Number.isFinite(qtd) || qtd <= 0) throw new Error(`Quantidade invalida para ${prod.nome}.`);
    const totalItem = prod.preco_centavos * qtd;
    subtotal += totalItem;
    itensCalc.push({ prod, qtd, totalItem });
  }

  const desconto = Math.max(0, Math.trunc(Number(dados.desconto_centavos || 0)));
  if (desconto > subtotal) throw new Error('Desconto maior que o subtotal.');
  const total = subtotal - desconto;
  const brinde = stmtBrindeParaTotal.get(total, total); // brinde por faixa (nao acumula)

  // 3. cabecalho do pedido
  const pedidoId = stmtInserirPedido.run({
    cliente_id: clienteId,
    cliente_nome: dados.cliente && dados.cliente.nome ? dados.cliente.nome.trim() : null,
    cliente_cpf: dados.cliente && dados.cliente.cpf ? dados.cliente.cpf.replace(/\D/g, '') : null,
    operador: dados.operador || null,
    device: dados.device || null,
    subtotal_centavos: subtotal,
    desconto_centavos: desconto,
    total_centavos: total,
    forma_pagamento: dados.forma_pagamento,
    pagamento_nsu: dados.pagamento_nsu || null,
    pagamento_bandeira: dados.pagamento_bandeira || null,
    brinde_id: brinde ? brinde.id : null,
    brinde_nome: brinde ? brinde.nome : null,
    observacao: dados.observacao || null,
  }).lastInsertRowid;

  // 4. baixa de estoque ATOMICA + itens + auditoria
  for (const { prod, qtd, totalItem } of itensCalc) {
    const r = stmtBaixarEstoque.run({ id: prod.id, qtd });
    if (r.changes === 0) {
      // saldo insuficiente -> aborta tudo (rollback automatico da transacao)
      const atual = stmtProduto.get(prod.id);
      throw new EstoqueInsuficiente(prod.nome, atual ? atual.estoque : 0);
    }
    stmtInserirItem.run({
      pedido_id: pedidoId, produto_id: prod.id, sku: prod.sku, nome: prod.nome,
      preco_unit_centavos: prod.preco_centavos, qtd, total_centavos: totalItem,
    });
    const resultante = prod.estoque - qtd;
    stmtMov.run({
      produto_id: prod.id, delta: -qtd, estoque_resultante: resultante,
      motivo: 'venda', pedido_id: pedidoId, operador: dados.operador || null,
    });
  }

  return pedidoId;
});

// ---------- transacao: cancelar pedido (devolve estoque) ----------
const cancelarPedidoTx = db.transaction((pedidoId, operador) => {
  const pedido = stmtPedido.get(pedidoId);
  if (!pedido) throw new Error('Pedido nao encontrado.');
  if (pedido.status === 'cancelado') throw new Error('Pedido ja esta cancelado.');
  const itens = stmtItensPedido.all(pedidoId);
  for (const it of itens) {
    stmtDevolverEstoque.run({ id: it.produto_id, qtd: it.qtd });
    const prod = stmtProduto.get(it.produto_id);
    stmtMov.run({
      produto_id: it.produto_id, delta: it.qtd, estoque_resultante: prod.estoque,
      motivo: 'cancelamento', pedido_id: pedidoId, operador: operador || null,
    });
  }
  db.prepare(`UPDATE pedidos SET status='cancelado' WHERE id=?`).run(pedidoId);
});

// ============================ ROTAS ============================

app.get('/api/config', (req, res) => {
  res.json({ eventName: EVENT_NAME, receiptMode: RECEIPT_MODE });
});

// Consulta cliente por CPF (autofill). Como o cliente so e criado ao comprar,
// "encontrado" = ja tem pelo menos uma compra.
app.get('/api/clientes/:cpf', (req, res) => {
  const cpf = String(req.params.cpf || '').replace(/\D/g, '');
  if (!cpfValido(cpf)) return res.status(400).json({ erro: 'CPF invalido.' });
  const c = stmtClientePorCpf.get(cpf);
  if (!c) return res.status(404).json({ erro: 'Cliente nao encontrado.' });
  const agg = db.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(total_centavos),0) AS total FROM pedidos WHERE cliente_id=? AND status='pago'"
  ).get(c.id);
  res.json({ nome: c.nome, email: c.email, telefone: c.telefone, pedidos: agg.n, total_centavos: agg.total });
});

// ---------- Brindes por faixa de ticket ----------
app.get('/api/brindes', (req, res) => {
  res.json(db.prepare('SELECT * FROM brindes ORDER BY min_centavos').all());
});
function validarBrinde(b) {
  const nome = (b.nome || '').trim();
  const min = Math.trunc(Number(b.min_centavos));
  const maxRaw = b.max_centavos;
  const max = (maxRaw === null || maxRaw === undefined || maxRaw === '') ? null : Math.trunc(Number(maxRaw));
  if (!nome) return { erro: 'Nome do brinde obrigatorio.' };
  if (!Number.isFinite(min) || min < 0) return { erro: 'Valor minimo invalido.' };
  if (max !== null && (!Number.isFinite(max) || max < min)) return { erro: 'Valor maximo deve ser >= minimo (ou vazio = sem limite).' };
  return { nome, min, max, imagem: b.imagem || null, ativo: (b.ativo === 0 || b.ativo === false) ? 0 : 1 };
}
app.post('/api/brindes', exigirAdmin, (req, res) => {
  const v = validarBrinde(req.body || {});
  if (v.erro) return res.status(400).json({ erro: v.erro });
  const r = db.prepare('INSERT INTO brindes (nome, min_centavos, max_centavos, imagem, ativo) VALUES (?, ?, ?, ?, ?)')
    .run(v.nome, v.min, v.max, v.imagem, v.ativo);
  res.status(201).json({ ok: true, id: r.lastInsertRowid });
});
app.post('/api/brindes/:id', exigirAdmin, (req, res) => {
  const v = validarBrinde(req.body || {});
  if (v.erro) return res.status(400).json({ erro: v.erro });
  const r = db.prepare("UPDATE brindes SET nome=?, min_centavos=?, max_centavos=?, imagem=?, ativo=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(v.nome, v.min, v.max, v.imagem, v.ativo, req.params.id);
  if (r.changes === 0) return res.status(404).json({ erro: 'Brinde nao encontrado.' });
  res.json({ ok: true });
});
app.post('/api/brindes/:id/excluir', exigirAdmin, (req, res) => {
  db.prepare('DELETE FROM brindes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/produtos', (req, res) => {
  const produtos = db.prepare(
    'SELECT id, sku, ean, nome, categoria, imagem, preco_centavos, preco_cheio_centavos, estoque, ativo FROM produtos WHERE ativo=1 ORDER BY nome'
  ).all();
  res.json(produtos);
});

app.post('/api/pedidos', (req, res) => {
  const b = req.body || {};
  // validacoes de fronteira
  if (!Array.isArray(b.itens) || b.itens.length === 0)
    return res.status(400).json({ erro: 'Pedido sem itens.' });
  if (!FORMAS.has(b.forma_pagamento))
    return res.status(400).json({ erro: 'Forma de pagamento invalida.' });
  if (!b.cliente || !cpfValido(b.cliente.cpf))
    return res.status(400).json({ erro: 'CPF invalido ou ausente.' });
  if (!b.cliente.nome || !b.cliente.nome.trim())
    return res.status(400).json({ erro: 'Nome do cliente obrigatorio.' });

  try {
    const id = criarPedidoTx(b);
    const pedido = stmtPedido.get(id);
    res.status(201).json({ ok: true, pedido });
  } catch (e) {
    if (e instanceof EstoqueInsuficiente)
      return res.status(409).json({ erro: e.message, produto: e.produto, disponivel: e.disponivel });
    console.error('Erro criar pedido:', e);
    res.status(400).json({ erro: e.message });
  }
});

app.get('/api/pedidos', (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 500);
  const pedidos = db.prepare(`
    SELECT p.* FROM pedidos p
    ORDER BY p.id DESC LIMIT ?`).all(limit);
  res.json(pedidos);
});

app.get('/api/pedidos/:id', (req, res) => {
  const pedido = stmtPedido.get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  const itens = stmtItensPedido.all(pedido.id);
  const cliente = pedido.cliente_id ? stmtCliente.get(pedido.cliente_id) : null;
  res.json({ pedido, itens, cliente });
});

// Recibo imprimivel (HTML 80mm)
app.get('/api/pedidos/:id/recibo', (req, res) => {
  const pedido = stmtPedido.get(req.params.id);
  if (!pedido) return res.status(404).send('Pedido nao encontrado.');
  const itens = stmtItensPedido.all(pedido.id);
  const cliente = pedido.cliente_id ? stmtCliente.get(pedido.cliente_id) : null;
  res.type('html').send(gerarReciboHTML(pedido, itens, cliente));
});

// Impressao em impressora termica de rede (ESC/POS)
app.post('/api/pedidos/:id/imprimir', async (req, res) => {
  const pedido = stmtPedido.get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  const itens = stmtItensPedido.all(pedido.id);
  const cliente = pedido.cliente_id ? stmtCliente.get(pedido.cliente_id) : null;
  try {
    await imprimirNaRede(gerarEscPos(pedido, itens, cliente));
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ erro: 'Falha ao imprimir: ' + e.message });
  }
});

// --------- Admin (protegido por PIN) ---------
app.post('/api/admin/login', (req, res) => {
  if (String((req.body || {}).pin) === ADMIN_PIN) return res.json({ ok: true });
  res.status(401).json({ erro: 'PIN invalido.' });
});

app.post('/api/pedidos/:id/cancelar', exigirAdmin, (req, res) => {
  try {
    cancelarPedidoTx(Number(req.params.id), (req.body || {}).operador);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ erro: e.message });
  }
});

// Ajuste/entrada de estoque (admin) com auditoria
app.post('/api/produtos/:id/ajuste', exigirAdmin, (req, res) => {
  const delta = Math.trunc(Number((req.body || {}).delta));
  const motivo = (req.body || {}).motivo || 'ajuste';
  if (!Number.isFinite(delta) || delta === 0)
    return res.status(400).json({ erro: 'Delta invalido.' });
  const ajustar = db.transaction(() => {
    const prod = stmtProduto.get(req.params.id);
    if (!prod) throw new Error('Produto nao encontrado.');
    if (prod.estoque + delta < 0) throw new Error('Ajuste deixaria estoque negativo.');
    if (delta < 0) stmtBaixarEstoque.run({ id: prod.id, qtd: -delta });
    else stmtDevolverEstoque.run({ id: prod.id, qtd: delta });
    const novo = prod.estoque + delta;
    stmtMov.run({
      produto_id: prod.id, delta, estoque_resultante: novo,
      motivo, pedido_id: null, operador: (req.body || {}).operador || 'admin',
    });
    return novo;
  });
  try { res.json({ ok: true, estoque: ajustar() }); }
  catch (e) { res.status(400).json({ erro: e.message }); }
});

// Atualizar preco (admin)
app.post('/api/produtos/:id/preco', exigirAdmin, (req, res) => {
  const preco = Math.trunc(Number((req.body || {}).preco_centavos));
  if (!Number.isFinite(preco) || preco < 0) return res.status(400).json({ erro: 'Preco invalido.' });
  const r = db.prepare(`UPDATE produtos SET preco_centavos=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(preco, req.params.id);
  if (r.changes === 0) return res.status(404).json({ erro: 'Produto nao encontrado.' });
  res.json({ ok: true });
});

// Dashboard / relatorios
app.get('/api/dashboard', exigirAdmin, (req, res) => {
  const resumo = db.prepare(`
    SELECT COUNT(*) AS pedidos, COALESCE(SUM(total_centavos),0) AS total
    FROM pedidos WHERE status='pago'`).get();
  const porForma = db.prepare(`
    SELECT forma_pagamento, COUNT(*) AS pedidos, COALESCE(SUM(total_centavos),0) AS total
    FROM pedidos WHERE status='pago' GROUP BY forma_pagamento`).all();
  const porProduto = db.prepare(`
    SELECT i.nome, SUM(i.qtd) AS unidades, SUM(i.total_centavos) AS total
    FROM pedido_itens i JOIN pedidos p ON p.id=i.pedido_id
    WHERE p.status='pago' GROUP BY i.produto_id ORDER BY unidades DESC`).all();
  const porVendedor = db.prepare(`
    SELECT COALESCE(operador,'(sem nome)') AS operador, COUNT(*) AS pedidos,
           COALESCE(SUM(total_centavos),0) AS total
    FROM pedidos WHERE status='pago' GROUP BY operador ORDER BY total DESC`).all();
  const estoqueBaixo = db.prepare(`
    SELECT nome, estoque FROM produtos WHERE ativo=1 AND estoque <= 5 ORDER BY estoque`).all();
  res.json({ resumo, porForma, porProduto, porVendedor, estoqueBaixo });
});

// Exports
app.get('/api/export/sankhya.csv', exigirAdmin, (req, res) => {
  res.type('text/csv').attachment('vendas-sankhya.csv').send('﻿' + exportVendasSankhya());
});
app.get('/api/export/clientes.csv', exigirAdmin, (req, res) => {
  res.type('text/csv').attachment('clientes.csv').send('﻿' + exportClientes());
});

// ---------- Separacao / entrega (Kanban de fulfillment) ----------
app.get('/api/separacao', (req, res) => {
  const limit = Math.min(Number(req.query.limit || 500), 2000);
  const pedidos = db.prepare(`
    SELECT p.id, p.created_at, p.operador, p.device, p.total_centavos,
           p.status, p.entrega_status, p.entrega_operador, p.entrega_updated_at,
           p.cliente_nome, p.brinde_nome
    FROM pedidos p
    ORDER BY p.id DESC LIMIT ?`).all(limit);
  const ids = pedidos.map((p) => p.id);
  const itensPorPedido = {};
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    for (const it of db.prepare(
      `SELECT pedido_id, nome, qtd, sku FROM pedido_itens WHERE pedido_id IN (${ph}) ORDER BY id`
    ).all(...ids)) {
      (itensPorPedido[it.pedido_id] ||= []).push(it);
    }
  }
  res.json(pedidos.map((p) => ({ ...p, itens: itensPorPedido[p.id] || [] })));
});

const ENTREGA_FASES = new Set(['novo', 'separacao', 'entregue']);
app.post('/api/pedidos/:id/entrega', (req, res) => {
  const status = (req.body || {}).status;
  if (!ENTREGA_FASES.has(status)) return res.status(400).json({ erro: 'Fase de entrega invalida.' });
  const pedido = stmtPedido.get(req.params.id);
  if (!pedido) return res.status(404).json({ erro: 'Pedido nao encontrado.' });
  if (pedido.status === 'cancelado') return res.status(409).json({ erro: 'Pedido cancelado nao pode ser separado.' });
  db.prepare(`UPDATE pedidos SET entrega_status=?, entrega_operador=?, entrega_updated_at=datetime('now','localtime') WHERE id=?`)
    .run(status, (req.body || {}).operador || null, pedido.id);
  res.json({ ok: true });
});

app.get('/', (req, res) => res.sendFile(join(__dirname, 'public', 'loja.html')));               // totem/cliente
app.get('/separacao', (req, res) => res.sendFile(join(__dirname, 'public', 'separacao.html'))); // fulfillment
app.get('/admin', (req, res) => res.sendFile(join(__dirname, 'public', 'admin.html')));
app.get('/health', (req, res) => res.json({ ok: true }));

// ---------- backup automatico ----------
function iniciarBackup() {
  const min = Number(process.env.BACKUP_INTERVAL_MIN || 5);
  if (!min) return;
  const dir = join(__dirname, 'data', 'backups');
  mkdirSync(dir, { recursive: true });
  const keep = Number(process.env.BACKUP_KEEP || 50);
  const rodar = async () => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      await db.backup(join(dir, `loja-${ts}.db`));
      const arquivos = readdirSync(dir).filter((f) => f.endsWith('.db'))
        .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const old of arquivos.slice(keep)) unlinkSync(join(dir, old.f));
    } catch (e) { console.error('Backup falhou:', e.message); }
  };
  setInterval(rodar, min * 60 * 1000);
  console.log(`Backup automatico a cada ${min} min em data/backups/`);
}

app.listen(PORT, '0.0.0.0', () => {
  const conta = db.prepare('SELECT COUNT(*) AS n FROM produtos').get().n;
  // Descobre os IPs reais desta maquina na(s) rede(s) — para os tablets acessarem.
  const ips = Object.entries(networkInterfaces())
    .flatMap(([nome, addrs]) => (addrs || [])
      .filter((a) => a.family === 'IPv4' && !a.internal)
      .map((a) => ({ nome, ip: a.address })));
  console.log(`\n  ${EVENT_NAME}  —  ${conta} produtos no catalogo`);
  console.log(`  Neste computador:  http://localhost:${PORT}`);
  if (ips.length) {
    console.log(`\n  >>> Nos tablets/notebooks (MESMA rede Wi-Fi), acesse: <<<`);
    for (const { nome, ip } of ips) {
      console.log(`    Loja:  http://${ip}:${PORT}        (interface ${nome})`);
    }
    const ip0 = ips[0].ip;
    console.log(`    Separacao: http://${ip0}:${PORT}/separacao    Admin: http://${ip0}:${PORT}/admin`);
    console.log(`\n  Se nao abrir em outro aparelho: confira se estao na MESMA rede e se`);
    console.log(`  o Wi-Fi nao tem "isolamento de clientes" (use o roteador do evento).`);
  } else {
    console.log(`  (nenhuma rede detectada — conecte o cabo/Wi-Fi)`);
  }
  console.log('');
  if (!existsSync(DB_PATH)) console.warn('  ATENCAO: banco nao encontrado.');
  iniciarBackup();
});
