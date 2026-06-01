'use strict';
// Loja / totem de autoatendimento. Cliente monta o pedido; promotor finaliza o pagamento.
// O estoque continua vivendo no servidor (mesma API do PDV) — sem risco de venda dupla.

const $ = (s) => document.querySelector(s);
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  totem: localStorage.getItem('totem') || '',
  produtos: [],
  categoria: 'Todos',
  busca: '',
  cart: new Map(),     // id -> { produto, qtd }
  forma: '',
  ultimoPedidoId: null,
  receiptMode: 'browser',
};

// ---------------- setup ----------------
function checarSetup() {
  if (state.totem) return iniciar();
  $('#setup').classList.remove('hidden');
}
$('#su-ok').addEventListener('click', () => {
  const v = $('#su-totem').value.trim();
  if (!v) return toast('Dê um nome ao totem', 'erro');
  localStorage.setItem('totem', v); state.totem = v;
  $('#setup').classList.add('hidden'); iniciar();
});

async function iniciar() {
  $('#loja').classList.remove('hidden');
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    $('#event-name').textContent = cfg.eventName || 'Natural Tech';
    state.receiptMode = cfg.receiptMode || 'browser';
  } catch { /* segue */ }
  await carregarProdutos();
  armarInatividade();
}

// ---------------- produtos ----------------
async function carregarProdutos() {
  try {
    state.produtos = await fetch('/api/produtos').then((r) => r.json());
    renderCategorias(); renderVitrine();
  } catch { toast('Sem conexão com o servidor', 'erro'); }
}

function renderCategorias() {
  const cats = ['Todos', ...new Set(state.produtos.map((p) => p.categoria).filter(Boolean))];
  const cont = $('#categorias');
  cont.innerHTML = '';
  for (const c of cats) {
    const b = document.createElement('button');
    b.className = 'pill' + (c === state.categoria ? ' sel' : '');
    b.textContent = c;
    b.addEventListener('click', () => { state.categoria = c; renderCategorias(); renderVitrine(); });
    cont.appendChild(b);
  }
}

function precoHtml(p) {
  const por = `<span class="preco-por">${brl(p.preco_centavos)}</span>`;
  const de = p.preco_cheio_centavos && p.preco_cheio_centavos > p.preco_centavos
    ? `<span class="preco-de">${brl(p.preco_cheio_centavos)}</span>` : '';
  return de + por;
}

function fotoHtml(p) {
  if (p.imagem) return `<div class="foto">${p.categoria ? `<span class="cat-chip">${esc(p.categoria)}</span>` : ''}<img src="/img/${esc(p.imagem)}" alt="${esc(p.nome)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph',textContent:'${esc(p.nome).replace(/'/g, '')}'}))"></div>`;
  return `<div class="foto">${p.categoria ? `<span class="cat-chip">${esc(p.categoria)}</span>` : ''}<div class="ph">${esc(p.nome)}</div></div>`;
}

function renderVitrine() {
  const termo = state.busca.trim().toLowerCase();
  const q = onlyDigits(state.busca);
  const lista = state.produtos.filter((p) => {
    if (state.categoria !== 'Todos' && p.categoria !== state.categoria) return false;
    if (!termo) return true;
    return p.nome.toLowerCase().includes(termo) || (p.sku || '').toLowerCase().includes(termo) || (p.ean || '') === q;
  });
  const cont = $('#vitrine');
  cont.innerHTML = '';
  for (const p of lista) {
    const noCart = state.cart.get(p.id);
    const qtd = noCart ? noCart.qtd : 0;
    const restante = p.estoque - qtd;
    const esgotado = p.estoque <= 0;
    const card = document.createElement('div');
    card.className = 'prod' + (esgotado ? ' esgotado' : '');
    let controle;
    if (esgotado) {
      controle = `<button class="add off" disabled>Esgotado</button>`;
    } else if (qtd > 0) {
      controle = `<div class="stepper">
        <button data-act="menos">−</button><span class="n">${qtd}</span>
        <button data-act="mais" ${restante <= 0 ? 'disabled' : ''}>+</button></div>`;
    } else {
      controle = `<button class="add" data-act="add">Adicionar</button>`;
    }
    card.innerHTML = `
      ${fotoHtml(p)}
      <div class="info">
        <div class="nome">${esc(p.nome)}</div>
        <div class="preco">${precoHtml(p)}</div>
        ${!esgotado && restante <= 5 ? `<div class="est-min">Só ${restante} restantes</div>` : ''}
        ${controle}
      </div>`;
    const add = card.querySelector('[data-act="add"]');
    if (add) add.addEventListener('click', () => mudar(p, +1));
    const mais = card.querySelector('[data-act="mais"]');
    if (mais) mais.addEventListener('click', () => mudar(p, +1));
    const menos = card.querySelector('[data-act="menos"]');
    if (menos) menos.addEventListener('click', () => mudar(p, -1));
    cont.appendChild(card);
  }
  if (!lista.length) cont.innerHTML = '<div class="cart-empty">Nenhum produto encontrado</div>';
}

$('#busca').addEventListener('input', (e) => { state.busca = e.target.value; renderVitrine(); });

// ---------------- carrinho ----------------
function mudar(p, delta) {
  const atual = state.produtos.find((x) => x.id === p.id) || p;
  const item = state.cart.get(p.id) || { produto: atual, qtd: 0 };
  const nova = item.qtd + delta;
  if (nova <= 0) state.cart.delete(p.id);
  else if (nova > atual.estoque) { toast('Sem estoque suficiente', 'erro'); return; }
  else { item.qtd = nova; item.produto = atual; state.cart.set(p.id, item); }
  renderVitrine(); renderCartBar(); if (!$('#drawer').classList.contains('hidden')) renderDrawer();
}

function totalCart() {
  let n = 0, c = 0;
  for (const [, i] of state.cart) { n += i.qtd; c += i.produto.preco_centavos * i.qtd; }
  return { n, c };
}
function renderCartBar() {
  const { n, c } = totalCart();
  const bar = $('#cartbar');
  if (n === 0) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#cb-count').textContent = n;
  $('#cb-total').textContent = brl(c);
}
function renderDrawer() {
  const cont = $('#cart-itens');
  if (state.cart.size === 0) {
    cont.innerHTML = '<div class="cart-empty">Seu pedido está vazio</div>';
  } else {
    cont.innerHTML = '';
    for (const [id, item] of state.cart) {
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        <div>
          <div class="nome">${esc(item.produto.nome)}</div>
          <div class="preco-unit">${brl(item.produto.preco_centavos)} un.</div>
          <div class="qty"><button data-a="menos">−</button><span>${item.qtd}</span><button data-a="mais">+</button></div>
        </div>
        <div class="total">${brl(item.produto.preco_centavos * item.qtd)}</div>`;
      row.querySelector('[data-a="menos"]').addEventListener('click', () => mudar(item.produto, -1));
      row.querySelector('[data-a="mais"]').addEventListener('click', () => mudar(item.produto, +1));
      cont.appendChild(row);
    }
  }
  $('#d-total').textContent = brl(totalCart().c);
}

$('#cartbar').addEventListener('click', () => { renderDrawer(); $('#drawer').classList.remove('hidden'); });
$('#fechar-cart').addEventListener('click', () => $('#drawer').classList.add('hidden'));
$('#continuar').addEventListener('click', () => $('#drawer').classList.add('hidden'));
$('#drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') $('#drawer').classList.add('hidden'); });

// ---------------- checkout ----------------
$('#ir-checkout').addEventListener('click', () => {
  if (state.cart.size === 0) return toast('Adicione produtos primeiro', 'erro');
  $('#drawer').classList.add('hidden');
  abrirCheckout();
});
function abrirCheckout() {
  $('#step-pagamento').classList.add('hidden');
  $('#step-dados').classList.remove('hidden');
  $('#checkout').classList.remove('hidden');
  validarDados();
}
$('#co-fechar').addEventListener('click', () => $('#checkout').classList.add('hidden'));
$('#d-voltar').addEventListener('click', () => { $('#checkout').classList.add('hidden'); renderDrawer(); $('#drawer').classList.remove('hidden'); });

function cpfValido(cpf) {
  const c = onlyDigits(cpf);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0; if (d1 !== +c[9]) return false;
  s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0; return d2 === +c[10];
}
function validarDados() {
  const ok = cpfValido($('#c-cpf').value) && $('#c-nome').value.trim().length > 1;
  $('#ir-pagamento').disabled = !ok;
}
['#c-cpf', '#c-nome'].forEach((s) => $(s).addEventListener('input', validarDados));

$('#ir-pagamento').addEventListener('click', () => {
  $('#step-dados').classList.add('hidden');
  $('#step-pagamento').classList.remove('hidden');
  $('#p-total').textContent = brl(totalCart().c);
  validarPagamento();
});
$('#p-voltar').addEventListener('click', () => {
  $('#step-pagamento').classList.add('hidden');
  $('#step-dados').classList.remove('hidden');
});

$('#pagamentos').addEventListener('click', (e) => {
  const b = e.target.closest('.pag'); if (!b) return;
  state.forma = b.dataset.forma;
  document.querySelectorAll('.pag').forEach((x) => x.classList.toggle('sel', x === b));
  $('#nsu-field').style.display = (state.forma === 'credito' || state.forma === 'debito') ? '' : 'none';
  validarPagamento();
});
$('#c-nsu').addEventListener('input', validarPagamento);
function validarPagamento() {
  const nsuOk = !(state.forma === 'credito' || state.forma === 'debito') || $('#c-nsu').value.trim().length > 0;
  $('#confirmar').disabled = !(state.forma && nsuOk);
}

$('#confirmar').addEventListener('click', confirmar);
async function confirmar() {
  const btn = $('#confirmar'); btn.disabled = true; btn.textContent = 'Processando...';
  const payload = {
    operador: state.totem, device: state.totem,
    cliente: {
      cpf: onlyDigits($('#c-cpf').value), nome: $('#c-nome').value.trim(),
      email: $('#c-email').value.trim() || null, telefone: $('#c-tel').value.trim() || null,
    },
    itens: [...state.cart.values()].map((i) => ({ produto_id: i.produto.id, qtd: i.qtd })),
    forma_pagamento: state.forma, pagamento_nsu: $('#c-nsu').value.trim() || null,
  };
  try {
    const resp = await fetch('/api/pedidos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await resp.json();
    if (!resp.ok) {
      if (resp.status === 409) { toast(`Sem estoque: ${data.produto}`, 'erro'); await carregarProdutos(); }
      else toast(data.erro || 'Erro ao finalizar', 'erro');
      return;
    }
    state.ultimoPedidoId = data.pedido.id;
    $('#checkout').classList.add('hidden');
    mostrarSucesso(data.pedido);
    await carregarProdutos();
  } catch { toast('Falha de conexão. Tente de novo.', 'erro'); }
  finally { btn.textContent = 'Confirmar pagamento'; validarPagamento(); }
}

// ---------------- sucesso ----------------
let autoTimer, autoCount;
function mostrarSucesso(pedido) {
  $('#ok-num').textContent = '#' + pedido.id;
  $('#ok-total').textContent = 'Total: ' + brl(pedido.total_centavos);
  $('#sucesso').classList.remove('hidden');
  let s = 25;
  $('#ok-auto').textContent = `Nova compra automática em ${s}s`;
  clearInterval(autoCount);
  autoCount = setInterval(() => { s--; $('#ok-auto').textContent = `Nova compra automática em ${s}s`; if (s <= 0) novaCompra(); }, 1000);
}
$('#ok-nova').addEventListener('click', novaCompra);
$('#ok-imprimir').addEventListener('click', async () => {
  const id = state.ultimoPedidoId; if (!id) return;
  if (state.receiptMode === 'network') {
    try { const r = await fetch(`/api/pedidos/${id}/imprimir`, { method: 'POST' }); toast(r.ok ? 'Enviado para impressora' : 'Falha na impressora', r.ok ? 'ok' : 'erro'); }
    catch { toast('Falha na impressora', 'erro'); }
  } else { window.open(`/api/pedidos/${id}/recibo`, '_blank'); }
});

function novaCompra() {
  clearInterval(autoCount);
  state.cart.clear(); state.forma = ''; state.categoria = 'Todos'; state.busca = '';
  ['#c-cpf', '#c-nome', '#c-email', '#c-tel', '#c-nsu'].forEach((s) => ($(s).value = ''));
  $('#busca').value = '';
  document.querySelectorAll('.pag').forEach((x) => x.classList.remove('sel'));
  $('#sucesso').classList.add('hidden'); $('#checkout').classList.add('hidden'); $('#drawer').classList.add('hidden');
  renderCategorias(); renderVitrine(); renderCartBar();
  window.scrollTo({ top: 0 });
}

// ---------------- inatividade (reseta o totem) ----------------
let idleTimer;
function armarInatividade() {
  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // só reseta se há algo em andamento (carrinho ou telas abertas)
      const ativo = state.cart.size > 0 || !$('#checkout').classList.contains('hidden') || !$('#drawer').classList.contains('hidden');
      if (ativo && $('#sucesso').classList.contains('hidden')) novaCompra();
    }, 120000); // 2 min
  };
  ['click', 'touchstart', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, reset, { passive: true }));
  reset();
}

// ---------------- util ----------------
let tt;
function toast(msg, tipo = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + tipo;
  clearTimeout(tt); tt = setTimeout(() => t.classList.add('hidden'), 2600);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
checarSetup();
