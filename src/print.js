// Comprovante de venda (nao-fiscal), sempre impresso via ESC/POS:
//   RECEIPT_MODE=cups     -> servidor envia ESC/POS para impressora USB local via CUPS (lp -o raw).
//   RECEIPT_MODE=network  -> servidor envia ESC/POS para impressora termica de rede (TCP 9100).
import net from 'node:net';
import { spawn } from 'node:child_process';

const COLS = Number(process.env.PRINTER_COLS || 48);
const STORE_NAME = process.env.STORE_NAME || 'TRUE';
const STORE_CNPJ = process.env.STORE_CNPJ || '';
const EVENT_NAME = process.env.EVENT_NAME || 'Natural Tech';

export const reais = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const FORMA_LABEL = {
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  pix: 'Pix',
  dinheiro: 'Dinheiro',
};

// ---------- ESC/POS ----------
function center(txt) {
  const t = txt.slice(0, COLS);
  const pad = Math.max(0, Math.floor((COLS - t.length) / 2));
  return ' '.repeat(pad) + t;
}
function lr(left, right) {
  const space = Math.max(1, COLS - left.length - right.length);
  return left + ' '.repeat(space) + right;
}
// Quebra um texto em linhas de ate COLS colunas, sem cortar palavras
// (palavra maior que COLS e fatiada). Usado no cabecalho do recibo.
function wrap(txt) {
  const lines = [];
  let line = '';
  for (const w of String(txt).split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + w).length > COLS) { lines.push(line); line = ''; }
    line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines.flatMap((l) => (l.length <= COLS ? [l] : l.match(new RegExp(`.{1,${COLS}}`, 'g'))));
}

export function gerarEscPos(pedido, itens, cliente) {
  const ESC = '\x1b', GS = '\x1d';
  let s = '';
  s += ESC + '@';                 // reset
  s += ESC + 'a' + '\x01';        // centralizar
  s += ESC + 'E' + '\x01';        // negrito
  s += wrap(STORE_NAME).join('\n') + '\n';  // nome longo quebra em varias linhas
  s += ESC + 'E' + '\x00';        // normal
  s += wrap(EVENT_NAME).join('\n') + '\n';
  if (STORE_CNPJ) s += 'CNPJ ' + STORE_CNPJ + '\n';
  s += ESC + 'a' + '\x00';        // esquerda
  s += '-'.repeat(COLS) + '\n';
  s += lr('Pedido #' + pedido.id, pedido.created_at) + '\n';
  if (pedido.operador) s += 'Vendedor: ' + pedido.operador + '\n';
  const cliNome = pedido.cliente_nome || (cliente && cliente.nome);
  const cliCpf = pedido.cliente_cpf || (cliente && cliente.cpf);
  if (cliNome) s += 'Cliente: ' + cliNome + '\n';
  if (cliCpf) s += 'CPF: ' + cliCpf + '\n';
  s += '-'.repeat(COLS) + '\n';
  for (const i of itens) {
    for (const ln of wrap(i.nome)) s += ln + '\n';   // nome completo, quebra em linhas
    const unit = i.preco_unit_centavos ?? Math.round(i.total_centavos / i.qtd);
    s += lr(`  ${i.qtd} x ${reais(unit)}`, reais(i.total_centavos)) + '\n';
  }
  s += '-'.repeat(COLS) + '\n';
  if (pedido.desconto_centavos) {
    s += lr('Subtotal', reais(pedido.subtotal_centavos)) + '\n';
    s += lr('Desconto', '- ' + reais(pedido.desconto_centavos)) + '\n';
  }
  s += ESC + '!' + '\x10';        // altura dupla
  s += lr('TOTAL', reais(pedido.total_centavos)) + '\n';
  s += ESC + '!' + '\x00';
  s += lr('Pagamento', FORMA_LABEL[pedido.forma_pagamento] || pedido.forma_pagamento) + '\n';
  if (pedido.pagamento_nsu) s += lr('NSU/Aut.', pedido.pagamento_nsu) + '\n';
  if (pedido.brinde_nome) { s += '-'.repeat(COLS) + '\n'; s += center('BRINDE: ' + pedido.brinde_nome) + '\n'; }
  s += '-'.repeat(COLS) + '\n';
  s += center('Documento NÃO fiscal') + '\n';
  s += center('NF emitida posteriormente') + '\n';
  s += center('Obrigado pela compra!') + '\n';
  s += '\n\n\n';
  s += GS + 'V' + '\x42' + '\x00'; // corte parcial
  return Buffer.from(ascii(s), 'latin1');
}

// A YICHIP nao usa latin1 na tabela padrao (CP437): acentos e o NBSP (0xA0) que o
// toLocaleString poe no "R$ " saem como simbolos. Normalizamos para ASCII puro
// (remove acentos, NBSP -> espaco) garantindo legibilidade em qualquer code page.
// Bytes de controle ESC/GS sao < 0x80, entao nao sao afetados.
function ascii(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x00-\x7f]/g, ' ');
}

export function imprimirNaRede(buffer) {
  return new Promise((resolve, reject) => {
    const host = process.env.PRINTER_HOST;
    const port = Number(process.env.PRINTER_PORT || 9100);
    if (!host) return reject(new Error('PRINTER_HOST nao configurado'));
    const socket = net.createConnection({ host, port }, () => {
      socket.write(buffer, () => socket.end());
    });
    socket.setTimeout(5000);
    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout impressora')); });
    socket.on('close', () => resolve());
  });
}

// Impressora USB local registrada no CUPS (ex.: YICHIP3121 POS-58). Envia o ESC/POS
// cru com `lp -o raw`, sem o filtro de texto do CUPS reinterpretar os bytes.
export function imprimirViaCups(buffer) {
  return new Promise((resolve, reject) => {
    const printer = process.env.PRINTER_CUPS_NAME;
    if (!printer) return reject(new Error('PRINTER_CUPS_NAME nao configurado'));
    const lp = spawn('lp', ['-d', printer, '-o', 'raw']);
    let stderr = '';
    lp.stderr.on('data', (d) => { stderr += d.toString(); });
    lp.on('error', reject);
    lp.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `lp saiu com codigo ${code}`));
    });
    lp.stdin.write(buffer);
    lp.stdin.end();
  });
}
