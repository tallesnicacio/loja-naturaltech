'use strict';
// PDV - logica do tablet. Fala com o servidor local; estoque vive no servidor.

const $ = (s) => document.querySelector(s);
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
function precoHtml(p) {
  const por = `<span class="preco-por">${brl(p.preco_centavos)}</span>`;
  const de = p.preco_cheio_centavos && p.preco_cheio_centavos > p.preco_centavos
    ? `<span class="preco-de">${brl(p.preco_cheio_centavos)}</span>` : '';
  return de + por;
}

const state = {
  operador: localStorage.getItem('operador') || '',
  device: localStorage.getItem('device') || '',
  produtos: [],
  cart: new Map(),        // produto_id -> { produto, qtd }
  forma: '',
  ultimoPedidoId: null,
  receiptMode: 'browser',
};

// ---------------- setup inicial ----------------
function checarSetup() {
  if (state.operador && state.device) { iniciarApp(); return; }
  $('#setup').classList.remove('hidden');
}
$('#su-ok').addEventListener('click', () => {
  const op = $('#su-operador').value.trim();
  const dev = $('#su-device').value.trim();
  if (!op || !dev) return toast('Preencha nome e tablet', 'erro');
  localStorage.setItem('operador', op);
  localStorage.setItem('device', dev);
  state.operador = op; state.device = dev;
  $('#setup').classList.add('hidden');
  iniciarApp();
});
$('#trocar').addEventListener('click', () => {
  localStorage.removeItem('operador'); localStorage.removeItem('device');
  location.reload();
});

async function iniciarApp() {
  $('#app').classList.remove('hidden');
  $('#op-nome').textContent = state.operador;
  $('#op-device').textContent = state.device;
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    $('#event-name').textContent = cfg.eventName || 'Natural Tech';
    state.receiptMode = cfg.receiptMode || 'browser';
  } catch { /* offline do config, segue */ }
  await carregarProdutos();
}

// ---------------- produtos ----------------
async function carregarProdutos() {
  try {
    state.produtos = await fetch('/api/produtos').then((r) => r.json());
    renderProdutos();
  } catch {
    toast('Sem conexão com o servidor', 'erro');
  }
}

function renderProdutos() {
  const q = onlyDigits($('#busca').value) || $('#busca').value.trim().toLowerCase();
  const termo = $('#busca').value.trim().toLowerCase();
  const lista = state.produtos.filter((p) =>
    !termo || p.nome.toLowerCase().includes(termo) || (p.sku || '').toLowerCase().includes(termo) || (p.ean || '') === q);
  const cont = $('#produtos');
  cont.innerHTML = '';
  for (const p of lista) {
    const noCart = state.cart.get(p.id);
    const restante = p.estoque - (noCart ? noCart.qtd : 0);
    const btn = document.createElement('button');
    btn.className = 'card';
    if (restante <= 0) btn.setAttribute('disabled', '');
    const estClass = restante <= 0 ? 'zero' : restante <= 5 ? 'baixo' : '';
    btn.innerHTML = `
      <div class="nome">${escapeHtml(p.nome)}</div>
      <div class="preco">${precoHtml(p)}</div>
      <div class="est ${estClass}">${restante <= 0 ? 'Esgotado' : restante + ' em estoque'}</div>`;
    btn.addEventListener('click', () => adicionar(p));
    cont.appendChild(btn);
  }
  if (!lista.length) cont.innerHTML = '<div class="cart-empty">Nenhum produto encontrado</div>';
}
$('#busca').addEventListener('input', renderProdutos);

// ---------------- carrinho ----------------
function adicionar(p) {
  const item = state.cart.get(p.id) || { produto: p, qtd: 0 };
  const atual = state.produtos.find((x) => x.id === p.id) || p;
  if (item.qtd + 1 > atual.estoque) return toast('Sem estoque suficiente', 'erro');
  item.qtd += 1;
  item.produto = atual;
  state.cart.set(p.id, item);
  renderCart(); renderProdutos();
}
function mudarQtd(id, delta) {
  const item = state.cart.get(id);
  if (!item) return;
  const atual = state.produtos.find((x) => x.id === id) || item.produto;
  const nova = item.qtd + delta;
  if (nova <= 0) { state.cart.delete(id); }
  else if (nova > atual.estoque) { toast('Sem estoque suficiente', 'erro'); }
  else { item.qtd = nova; }
  renderCart(); renderProdutos();
}
function renderCart() {
  const cont = $('#cart');
  if (state.cart.size === 0) {
    cont.innerHTML = '<div class="cart-empty">Toque num produto para adicionar</div>';
  } else {
    cont.innerHTML = '';
    for (const [id, item] of state.cart) {
      const totalItem = item.produto.preco_centavos * item.qtd;
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div>
          <div class="nome">${escapeHtml(item.produto.nome)}</div>
          <div class="preco-unit">${brl(item.produto.preco_centavos)} un.</div>
          <div class="qty">
            <button data-act="menos">−</button><span>${item.qtd}</span><button data-act="mais">+</button>
            <button class="rm" data-act="rm" title="Remover">🗑</button>
          </div>
        </div>
        <div class="total">${brl(totalItem)}</div>`;
      row.querySelector('[data-act="menos"]').addEventListener('click', () => mudarQtd(id, -1));
      row.querySelector('[data-act="mais"]').addEventListener('click', () => mudarQtd(id, +1));
      row.querySelector('[data-act="rm"]').addEventListener('click', () => { state.cart.delete(id); renderCart(); renderProdutos(); });
      cont.appendChild(row);
    }
  }
  recalcular();
}

function subtotalCentavos() {
  let s = 0;
  for (const [, item] of state.cart) s += item.produto.preco_centavos * item.qtd;
  return s;
}
function descontoCentavos() {
  return Math.max(0, Math.round(Number($('#desconto').value || 0) * 100));
}
function recalcular() {
  const sub = subtotalCentavos();
  let desc = descontoCentavos();
  if (desc > sub) { desc = sub; $('#desconto').value = (sub / 100).toFixed(2); }
  $('#t-subtotal').textContent = brl(sub);
  $('#t-total').textContent = brl(sub - desc);
  validarFinalizar();
}
$('#desconto').addEventListener('input', recalcular);

// ---------------- pagamento ----------------
$('#pagamentos').addEventListener('click', (e) => {
  const b = e.target.closest('.pag');
  if (!b) return;
  state.forma = b.dataset.forma;
  document.querySelectorAll('.pag').forEach((x) => x.classList.toggle('sel', x === b));
  const precisaNsu = state.forma === 'credito' || state.forma === 'debito';
  $('#nsu-field').style.display = precisaNsu ? '' : 'none';
  validarFinalizar();
});

['#c-cpf', '#c-nome', '#c-nsu'].forEach((s) => $(s).addEventListener('input', validarFinalizar));

function cpfValido(cpf) {
  const c = onlyDigits(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0; if (d1 !== +c[9]) return false;
  s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0; return d2 === +c[10];
}

function validarFinalizar() {
  const temItem = state.cart.size > 0;
  const cpfOk = cpfValido($('#c-cpf').value);
  const nomeOk = $('#c-nome').value.trim().length > 1;
  const formaOk = !!state.forma;
  const nsuOk = !(state.forma === 'credito' || state.forma === 'debito') || $('#c-nsu').value.trim().length > 0;
  $('#finalizar').disabled = !(temItem && cpfOk && nomeOk && formaOk && nsuOk);
}

// ---------------- finalizar ----------------
$('#finalizar').addEventListener('click', finalizar);
async function finalizar() {
  const btn = $('#finalizar');
  btn.disabled = true; btn.textContent = 'Processando...';
  const payload = {
    operador: state.operador,
    device: state.device,
    cliente: {
      cpf: onlyDigits($('#c-cpf').value),
      nome: $('#c-nome').value.trim(),
      email: $('#c-email').value.trim() || null,
      telefone: $('#c-tel').value.trim() || null,
    },
    itens: [...state.cart.values()].map((i) => ({ produto_id: i.produto.id, qtd: i.qtd })),
    desconto_centavos: descontoCentavos(),
    forma_pagamento: state.forma,
    pagamento_nsu: $('#c-nsu').value.trim() || null,
  };
  try {
    const resp = await fetch('/api/pedidos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (resp.status === 409) {
        toast(`Sem estoque: ${data.produto}`, 'erro');
        await carregarProdutos();   // sincroniza estoque real
      } else {
        toast(data.erro || 'Erro ao finalizar', 'erro');
      }
      return;
    }
    state.ultimoPedidoId = data.pedido.id;
    mostrarSucesso(data.pedido);
    await carregarProdutos();
  } catch {
    toast('Falha de conexão. Tente de novo.', 'erro');
  } finally {
    btn.textContent = 'Finalizar venda';
    validarFinalizar();
  }
}

function mostrarSucesso(pedido) {
  $('#m-num').textContent = '#' + pedido.id;
  $('#m-total').textContent = 'Total: ' + brl(pedido.total_centavos);
  $('#modal').classList.remove('hidden');
}
$('#m-nova').addEventListener('click', () => { $('#modal').classList.add('hidden'); novaVenda(); });
$('#m-imprimir').addEventListener('click', async () => {
  const id = state.ultimoPedidoId;
  if (!id) return;
  if (state.receiptMode === 'network') {
    try {
      const r = await fetch(`/api/pedidos/${id}/imprimir`, { method: 'POST' });
      if (r.ok) toast('Enviado para impressora', 'ok'); else toast('Falha na impressora', 'erro');
    } catch { toast('Falha na impressora', 'erro'); }
  } else {
    window.open(`/api/pedidos/${id}/recibo`, '_blank');
  }
});

function novaVenda() {
  state.cart.clear(); state.forma = '';
  ['#c-cpf', '#c-nome', '#c-email', '#c-tel', '#c-nsu'].forEach((s) => ($(s).value = ''));
  $('#desconto').value = '0';
  document.querySelectorAll('.pag').forEach((x) => x.classList.remove('sel'));
  $('#nsu-field').style.display = '';
  $('#busca').value = '';
  renderCart(); renderProdutos();
}
$('#limpar').addEventListener('click', () => { if (confirm('Cancelar este pedido?')) novaVenda(); });

// ---------------- util ----------------
let toastTimer;
function toast(msg, tipo = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + tipo;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// service worker (cache do app shell para resiliencia)
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

checarSetup();
