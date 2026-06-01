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
    const ev = $('#event-name'); if (ev) ev.textContent = cfg.eventName || 'Natural Tech';
    state.receiptMode = cfg.receiptMode || 'browser';
  } catch { /* segue */ }
  try { state.brindes = await fetch('/api/brindes').then((r) => r.json()); } catch { state.brindes = []; }
  renderBrindeBanner();
  await carregarProdutos();
  armarInatividade();
}

// ---------------- produtos ----------------
async function carregarProdutos() {
  try {
    state.produtos = await fetch('/api/produtos').then((r) => r.json());
    renderCategorias(); renderVitrine(); renderCart();
  } catch { toast('Sem conexão com o servidor', 'erro'); }
}

function imagemCategoria(cat) {
  if (cat === 'Todos') return '/icons/logo.png';
  const p = state.produtos.find((x) => x.categoria === cat && x.imagem);
  return p ? `/img/${p.imagem}` : '/icons/logo.png';
}
function renderCategorias() {
  const cats = ['Todos', ...new Set(state.produtos.map((p) => p.categoria).filter(Boolean))];
  const cont = $('#categorias');
  cont.innerHTML = '';
  for (const c of cats) {
    const b = document.createElement('button');
    b.className = 'cat' + (c === state.categoria ? ' sel' : '');
    b.innerHTML = `<span class="cat-circ"><img src="${imagemCategoria(c)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'"></span><span class="cat-nome">${esc(c)}</span>`;
    b.addEventListener('click', () => { state.categoria = c; renderCategorias(); renderVitrine(); });
    cont.appendChild(b);
  }
}
// Banner que lembra os brindes (faixa larga, dinamica a partir dos brindes ativos).
function renderBrindeBanner() {
  const el = $('#brinde-banner'); if (!el) return;
  // Banner estatico (imagem) tem prioridade: se houver <img>, apenas exibe (nao sobrescreve).
  if (el.querySelector('img')) { el.classList.add('tem-img'); el.classList.remove('hidden'); return; }
  el.classList.remove('tem-img');
  const ativos = brindesAtivos();
  if (!ativos.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  const itens = ativos.map((b) => `
    <div class="bb-item">${brindeFotoHtml(b)}<div class="bb-txt"><span class="bb-min">a partir de ${brl(b.min_centavos)}</span><span class="bb-nome">${esc(b.nome)}</span></div></div>`).join('<span class="bb-sep">•</span>');
  el.innerHTML = `<div class="bb-tag">🎁 Ganhe brindes</div><div class="bb-itens">${itens}</div>`;
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
  renderVitrine(); renderCart();
}

function totalCart() {
  let n = 0, c = 0;
  for (const [, i] of state.cart) { n += i.qtd; c += i.produto.preco_centavos * i.qtd; }
  return { n, c };
}
function renderCart() {
  const cont = $('#cart-itens');
  if (!cont) return;
  if (state.cart.size === 0) {
    cont.innerHTML = '<div class="cart-empty">Seu carrinho está vazio.<br>Toque nos produtos para adicionar.</div>';
  } else {
    cont.innerHTML = '';
    for (const [id, item] of state.cart) {
      const p = item.produto;
      const foto = p.imagem
        ? `<img class="ci-foto" src="/img/${esc(p.imagem)}" alt="" onerror="this.classList.add('ci-ph');this.removeAttribute('src')">`
        : `<div class="ci-foto ci-ph"></div>`;
      const row = document.createElement('div');
      row.className = 'cart-item';
      row.innerHTML = `
        ${foto}
        <div class="ci-info">
          <div class="nome">${esc(p.nome)}</div>
          <div class="preco-unit">${brl(p.preco_centavos)} un.</div>
          <div class="qty"><button data-a="menos">−</button><span>${item.qtd}</span><button data-a="mais">+</button></div>
        </div>
        <div class="ci-right">
          <div class="total">${brl(p.preco_centavos * item.qtd)}</div>
          <button class="rm" data-a="rm" title="Remover">🗑</button>
        </div>`;
      row.querySelector('[data-a="menos"]').addEventListener('click', () => mudar(p, -1));
      row.querySelector('[data-a="mais"]').addEventListener('click', () => mudar(p, +1));
      row.querySelector('[data-a="rm"]').addEventListener('click', () => { state.cart.delete(id); renderCart(); renderVitrine(); });
      cont.appendChild(row);
    }
  }
  $('#d-total').textContent = brl(totalCart().c);
  $('#ir-checkout').disabled = state.cart.size === 0;
  renderBrindeCarrinho();
  // barra flutuante do mobile
  const fab = $('#cart-fab');
  if (fab) {
    const { n, c } = totalCart();
    if (n > 0) { fab.classList.remove('hidden'); $('#cf-count').textContent = n; $('#cf-total').textContent = brl(c); }
    else { fab.classList.add('hidden'); fecharSheet(); }
  }
}

// ---------- carrinho como folha deslizante (mobile) ----------
function abrirSheet() { $('#cart-panel').classList.add('aberto'); $('#cart-backdrop').classList.remove('hidden'); }
function fecharSheet() { const p = $('#cart-panel'); if (p) p.classList.remove('aberto'); const b = $('#cart-backdrop'); if (b) b.classList.add('hidden'); }
$('#cart-fab').addEventListener('click', abrirSheet);
$('#cart-backdrop').addEventListener('click', fecharSheet);
$('#fechar-cart').addEventListener('click', fecharSheet);

// ---------------- brindes por faixa de ticket ----------------
function brindesAtivos() {
  return (state.brindes || []).filter((b) => b.ativo).sort((a, b) => a.min_centavos - b.min_centavos);
}
function calcBrinde(total) {
  let atual = null;
  for (const b of brindesAtivos()) {
    if (total >= b.min_centavos && (b.max_centavos == null || total <= b.max_centavos)) atual = b;
  }
  const proximo = brindesAtivos().find((b) => b.min_centavos > total);
  return { atual, proximo };
}
function brindeFotoHtml(b) {
  return b && b.imagem ? `<img class="brinde-foto" src="${b.imagem}" alt="">` : '<div class="brinde-foto brinde-ph">🎁</div>';
}
function brindePorNome(n) { return (state.brindes || []).find((b) => b.nome === n); }

function renderBrindeCarrinho() {
  const el = $('#cart-brinde');
  if (!el) return;
  const total = totalCart().c;
  const { atual, proximo } = calcBrinde(total);
  if (state.cart.size === 0 || (!atual && !proximo)) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  let html = '';
  if (atual) html += `<div class="cb-ganhou">${brindeFotoHtml(atual)}<span>🎁 Você ganhou: <b>${esc(atual.nome)}</b></span></div>`;
  if (proximo) html += `<div class="cb-falta">Faltam <b>${brl(proximo.min_centavos - total)}</b> para ganhar ${esc(proximo.nome)}</div>`;
  el.innerHTML = html;
}

// Banner do brinde dentro do checkout
function renderCoBrinde() {
  const el = $('#co-brinde'); if (!el) return;
  const { atual } = calcBrinde(totalCart().c);
  if (!atual) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.classList.remove('hidden');
  el.innerHTML = `${brindeFotoHtml(atual)}<div class="co-brinde-txt"><div class="bg-label">🎁 Você ganhou um brinde!</div><div class="bg-nome">${esc(atual.nome)}</div></div>`;
}

// carrinho agora é um painel fixo à direita (sem barra inferior / drawer)

// ---------------- checkout ----------------
$('#ir-checkout').addEventListener('click', () => {
  if (state.cart.size === 0) return toast('Adicione produtos primeiro', 'erro');
  fecharSheet();
  abrirCheckout();
});
function abrirCheckout() {
  $('#step-pagamento').classList.add('hidden');
  $('#step-dados').classList.remove('hidden');
  renderCoBrinde();
  $('#checkout').classList.remove('hidden');
  validarDados();
}
$('#co-fechar').addEventListener('click', () => $('#checkout').classList.add('hidden'));
$('#d-voltar').addEventListener('click', () => { $('#checkout').classList.add('hidden'); });

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
  const okb = $('#ok-brinde');
  if (okb) {
    if (pedido.brinde_nome) {
      okb.innerHTML = `${brindeFotoHtml(brindePorNome(pedido.brinde_nome))}<span>🎁 Brinde: <b>${esc(pedido.brinde_nome)}</b></span>`;
      okb.classList.remove('hidden');
    } else { okb.classList.add('hidden'); }
  }
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
  $('#sucesso').classList.add('hidden'); $('#checkout').classList.add('hidden');
  renderCategorias(); renderVitrine(); renderCart();
  window.scrollTo({ top: 0 });
}

// ---------------- inatividade (reseta o totem) ----------------
let idleTimer;
function armarInatividade() {
  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      // só reseta se há algo em andamento (carrinho ou telas abertas)
      const ativo = state.cart.size > 0 || !$('#checkout').classList.contains('hidden');
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
