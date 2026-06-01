'use strict';
// Kanban de separacao/entrega + ALERTA de novo pedido (som via Web Audio, sem arquivo,
// funciona offline) + destaque visual. Atualiza sozinho (polling 4s).

const $ = (s) => document.querySelector(s);
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hora = (s) => (s || '').slice(11, 16);

const FASES = ['novo', 'separacao', 'entregue', 'cancelado'];
const state = {
  pedidos: [],
  busca: '',
  conferente: localStorage.getItem('conferente') || '',
  seen: new Set(),        // ids ja vistos (para detectar pedido NOVO de verdade)
  recentes: new Set(),    // ids para destacar (pulse) por alguns segundos
  alertReady: false,      // nao alerta no primeiro carregamento
  som: localStorage.getItem('sep_som') !== '0',
};

$('#conferente').value = state.conferente;
$('#conferente').addEventListener('input', (e) => {
  state.conferente = e.target.value.trim();
  localStorage.setItem('conferente', state.conferente);
});
$('#busca').addEventListener('input', (e) => { state.busca = e.target.value.trim().toLowerCase(); render(); });

// ---------- som ----------
function aplicarSomBtn() { $('#som').textContent = state.som ? '🔔' : '🔕'; }
$('#som').addEventListener('click', () => {
  state.som = !state.som;
  localStorage.setItem('sep_som', state.som ? '1' : '0');
  aplicarSomBtn();
  if (state.som) beep();   // toca um preview ao ligar (e destrava o audio)
});
aplicarSomBtn();

let actx;
function unlock() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch { /* sem audio */ }
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock));
function tom(freq, t0, dur) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.connect(g); g.connect(actx.destination);
  o.type = 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0); o.stop(t0 + dur + 0.02);
}
function beep() {
  if (!state.som) return;
  try { unlock(); if (!actx) return; const n = actx.currentTime; tom(880, n, 0.18); tom(1175, n + 0.2, 0.3); } catch { /* ok */ }
}

// ---------- alerta visual ----------
let bannerTimer;
function alerta(novos) {
  const el = $('#alerta');
  const ids = novos.map((p) => '#' + p.id).join(', ');
  el.textContent = `🔔 ${novos.length} novo${novos.length > 1 ? 's' : ''} pedido${novos.length > 1 ? 's' : ''}! (${ids})`;
  el.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.add('hidden'), 6000);
  const head = document.querySelector('.col-head.novo');
  if (head) { head.classList.remove('flash'); void head.offsetWidth; head.classList.add('flash'); }
}

function faseDe(p) {
  if (p.status === 'cancelado') return 'cancelado';
  return FASES.includes(p.entrega_status) ? p.entrega_status : 'novo';
}

async function carregar() {
  try {
    state.pedidos = await fetch('/api/separacao').then((r) => r.json());
    $('#auto').textContent = 'atualizado ' + new Date().toLocaleTimeString('pt-BR');
    // pedidos NOVOS (id nunca visto) que estao na coluna "novo"
    const novos = state.pedidos.filter((p) => faseDe(p) === 'novo' && !state.seen.has(p.id));
    state.pedidos.forEach((p) => state.seen.add(p.id));
    if (state.alertReady && novos.length) {
      novos.forEach((p) => {
        state.recentes.add(p.id);
        setTimeout(() => { state.recentes.delete(p.id); render(); }, 12000);
      });
      beep();
      alerta(novos);
    }
    state.alertReady = true;
    render();
  } catch {
    $('#auto').textContent = 'sem conexão';
  }
}

function botoes(p, fase) {
  if (fase === 'novo')
    return `<button class="btn verde mini" data-mv="separacao">Iniciar separação →</button>`;
  if (fase === 'separacao')
    return `<button class="btn verde mini" data-mv="entregue">✓ Entregue ao cliente</button>
            <button class="btn ghost mini" data-mv="novo">↩ Voltar</button>`;
  if (fase === 'entregue')
    return `<button class="btn ghost mini" data-mv="separacao">↩ Reabrir</button>`;
  return '';
}

function cardHtml(p, fase) {
  const itens = (p.itens || []).map((i) => `<li><b>${i.qtd}×</b> ${esc(i.nome)}</li>`).join('');
  const totItens = (p.itens || []).reduce((s, i) => s + i.qtd, 0);
  const pulse = state.recentes.has(p.id) ? ' pulse' : '';
  return `
    <div class="ped${pulse}" data-id="${p.id}">
      <div class="ped-top">
        <span class="ped-id">#${p.id}</span>
        <span class="ped-hora">${hora(p.created_at)}</span>
      </div>
      <div class="ped-cli">${esc(p.cliente_nome || 'Cliente')}</div>
      <div class="ped-vend">Vendedor: ${esc(p.operador || '—')}</div>
      <ul class="ped-itens">${itens || '<li>(sem itens)</li>'}</ul>
      <div class="ped-foot">
        <span>${totItens} ${totItens === 1 ? 'item' : 'itens'}</span>
        <b>${brl(p.total_centavos)}</b>
      </div>
      ${p.entrega_operador && fase === 'entregue' ? `<div class="ped-conf">por ${esc(p.entrega_operador)} ${hora(p.entrega_updated_at)}</div>` : ''}
      <div class="ped-acts">
        ${botoes(p, fase)}
        <a class="linkbtn mini" href="/api/pedidos/${p.id}/recibo" target="_blank">imprimir</a>
      </div>
    </div>`;
}

function render() {
  const cols = { novo: [], separacao: [], entregue: [], cancelado: [] };
  for (const p of state.pedidos) {
    if (state.busca) {
      const alvo = (`#${p.id} ` + (p.cliente_nome || '')).toLowerCase();
      if (!alvo.includes(state.busca)) continue;
    }
    cols[faseDe(p)].push(p);
  }
  for (const fase of FASES) {
    const body = $('#col-' + fase);
    const scroll = body.scrollTop;
    const lista = (fase === 'novo' || fase === 'separacao') ? [...cols[fase]].reverse() : cols[fase];
    body.innerHTML = lista.map((p) => cardHtml(p, fase)).join('') || '<div class="vazio">—</div>';
    body.scrollTop = scroll;
    $('#cnt-' + fase).textContent = cols[fase].length;
  }
  document.querySelectorAll('.ped').forEach((el) => {
    const id = Number(el.dataset.id);
    el.querySelectorAll('[data-mv]').forEach((b) => b.addEventListener('click', () => mover(id, b.dataset.mv)));
  });
}

async function mover(id, novaFase) {
  const p = state.pedidos.find((x) => x.id === id);
  if (p) p.entrega_status = novaFase;
  render();
  try {
    const r = await fetch(`/api/pedidos/${id}/entrega`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: novaFase, operador: state.conferente || null }),
    });
    if (!r.ok) { const d = await r.json(); toast(d.erro || 'Erro', 'erro'); }
    else if (novaFase === 'entregue') toast(`Pedido #${id} entregue ✓`, 'ok');
  } catch { toast('Falha de conexão', 'erro'); }
  carregar();
}

let tt;
function toast(msg, tipo = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + tipo;
  clearTimeout(tt); tt = setTimeout(() => t.classList.add('hidden'), 2600);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
carregar();
setInterval(carregar, 4000);
