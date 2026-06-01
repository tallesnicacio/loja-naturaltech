// Comprovante de venda (nao-fiscal). Dois modos:
//   RECEIPT_MODE=browser  -> /api/pedidos/:id/recibo devolve HTML 80mm que o tablet imprime.
//   RECEIPT_MODE=network  -> servidor envia ESC/POS direto para impressora termica de rede.
import net from 'node:net';

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

// ---------- Recibo em HTML (modo browser) ----------
export function gerarReciboHTML(pedido, itens, cliente) {
  const linhasItens = itens.map((i) => `
    <tr>
      <td class="q">${i.qtd}x</td>
      <td class="n">${escapeHtml(i.nome)}</td>
      <td class="v">${reais(i.total_centavos)}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Comprovante #${pedido.id}</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { font-family: "Courier New", monospace; width: 80mm; margin: 0 auto; padding: 6mm 4mm; color: #000; font-size: 12px; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2px; text-transform: uppercase; }
  .sub { text-align: center; font-size: 11px; margin: 0 0 8px; }
  .hr { border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { vertical-align: top; padding: 1px 0; }
  td.q { width: 28px; }
  td.v { text-align: right; white-space: nowrap; padding-left: 6px; }
  .tot { font-size: 14px; font-weight: bold; }
  .row { display: flex; justify-content: space-between; }
  .center { text-align: center; }
  .small { font-size: 10px; }
  .btn { display:block; width:100%; padding:12px; margin-top:14px; font-size:14px; }
  @media print { .btn { display: none; } }
</style></head>
<body onload="window.print()">
  <h1>${escapeHtml(STORE_NAME)}</h1>
  <div class="sub">${escapeHtml(EVENT_NAME)}${STORE_CNPJ ? `<br>CNPJ ${escapeHtml(STORE_CNPJ)}` : ''}</div>
  <div class="hr"></div>
  <div class="row"><span>Pedido</span><span>#${pedido.id}</span></div>
  <div class="row"><span>Data</span><span>${escapeHtml(pedido.created_at)}</span></div>
  ${pedido.operador ? `<div class="row"><span>Vendedor</span><span>${escapeHtml(pedido.operador)}</span></div>` : ''}
  ${(pedido.cliente_nome || (cliente && cliente.nome)) ? `<div class="row"><span>Cliente</span><span>${escapeHtml(pedido.cliente_nome || (cliente && cliente.nome) || '')}</span></div>` : ''}
  ${(pedido.cliente_cpf || (cliente && cliente.cpf)) ? `<div class="row"><span>CPF</span><span>${escapeHtml(pedido.cliente_cpf || (cliente && cliente.cpf))}</span></div>` : ''}
  <div class="hr"></div>
  <table>${linhasItens}</table>
  <div class="hr"></div>
  ${pedido.desconto_centavos ? `<div class="row"><span>Subtotal</span><span>${reais(pedido.subtotal_centavos)}</span></div>
  <div class="row"><span>Desconto</span><span>- ${reais(pedido.desconto_centavos)}</span></div>` : ''}
  <div class="row tot"><span>TOTAL</span><span>${reais(pedido.total_centavos)}</span></div>
  <div class="row"><span>Pagamento</span><span>${escapeHtml(FORMA_LABEL[pedido.forma_pagamento] || pedido.forma_pagamento)}</span></div>
  ${pedido.pagamento_nsu ? `<div class="row small"><span>NSU/Aut.</span><span>${escapeHtml(pedido.pagamento_nsu)}</span></div>` : ''}
  <div class="hr"></div>
  <div class="center small">Documento NAO fiscal.<br>Nota fiscal sera emitida posteriormente.</div>
  <div class="center small">Obrigado pela compra! 🧡</div>
  <button class="btn" onclick="window.print()">Imprimir</button>
</body></html>`;
}

// ---------- ESC/POS (modo network) ----------
function center(txt) {
  const t = txt.slice(0, COLS);
  const pad = Math.max(0, Math.floor((COLS - t.length) / 2));
  return ' '.repeat(pad) + t;
}
function lr(left, right) {
  const space = Math.max(1, COLS - left.length - right.length);
  return left + ' '.repeat(space) + right;
}

export function gerarEscPos(pedido, itens, cliente) {
  const ESC = '\x1b', GS = '\x1d';
  let s = '';
  s += ESC + '@';                 // reset
  s += ESC + 'a' + '\x01';        // centralizar
  s += ESC + '!' + '\x18';        // negrito + duplo
  s += STORE_NAME + '\n';
  s += ESC + '!' + '\x00';        // normal
  s += EVENT_NAME + '\n';
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
    s += lr(`${i.qtd}x ${i.nome}`.slice(0, COLS - 10), reais(i.total_centavos)) + '\n';
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
  s += '-'.repeat(COLS) + '\n';
  s += center('Documento NAO fiscal') + '\n';
  s += center('NF emitida posteriormente') + '\n';
  s += center('Obrigado pela compra!') + '\n';
  s += '\n\n\n';
  s += GS + 'V' + '\x42' + '\x00'; // corte parcial
  return Buffer.from(s, 'latin1');
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

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
