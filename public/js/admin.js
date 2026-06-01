'use strict';
const $ = (s) => document.querySelector(s);
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let PIN = sessionStorage.getItem('adminPin') || '';

function H() { return { 'x-admin-pin': PIN, 'Content-Type': 'application/json' }; }

async function login() {
  const pin = $('#pin').value.trim();
  const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
  if (!r.ok) return toast('PIN inválido', 'erro');
  PIN = pin; sessionStorage.setItem('adminPin', pin);
  $('#login').classList.add('hidden'); $('#painel').classList.remove('hidden');
  carregarTudo();
}
$('#entrar').addEventListener('click', login);
$('#pin').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('#atualizar').addEventListener('click', carregarTudo);

async function carregarTudo() {
  await Promise.all([carregarDashboard(), carregarEstoque(), carregarPedidos()]);
}

async function carregarDashboard() {
  const d = await fetch('/api/dashboard', { headers: H() }).then((r) => r.json());
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="v">${brl(d.resumo.total)}</div><div class="l">Faturamento</div></div>
    <div class="kpi"><div class="v">${d.resumo.pedidos}</div><div class="l">Pedidos pagos</div></div>
    ${d.porForma.map((f) => `<div class="kpi"><div class="v">${brl(f.total)}</div><div class="l">${f.forma_pagamento} (${f.pedidos})</div></div>`).join('')}`;

  $('#tbl-produtos').innerHTML = `<tr><th>Produto</th><th class="num">Unid.</th><th class="num">Total</th></tr>` +
    d.porProduto.map((p) => `<tr><td>${esc(p.nome)}</td><td class="num">${p.unidades}</td><td class="num">${brl(p.total)}</td></tr>`).join('');

  $('#tbl-vendedores').innerHTML = `<tr><th>Vendedor</th><th class="num">Pedidos</th><th class="num">Total</th></tr>` +
    d.porVendedor.map((v) => `<tr><td>${esc(v.operador)}</td><td class="num">${v.pedidos}</td><td class="num">${brl(v.total)}</td></tr>`).join('');
}

async function carregarEstoque() {
  const produtos = await fetch('/api/produtos').then((r) => r.json());
  const t = $('#tbl-estoque');
  t.innerHTML = `<tr><th>Produto</th><th class="num">Preço</th><th class="num">Estoque</th><th>Ações</th></tr>` +
    produtos.map((p) => `
      <tr data-id="${p.id}">
        <td>${esc(p.nome)}<br><small style="color:#8E8E8D">${p.sku}</small></td>
        <td class="num">
          <input type="number" step="0.01" min="0" value="${(p.preco_centavos/100).toFixed(2)}" style="width:90px;padding:6px;border:1px solid #E2E2E2;border-radius:6px" class="in-preco">
          <button class="linkbtn salvar-preco">salvar</button>
        </td>
        <td class="num"><b class="est">${p.estoque}</b></td>
        <td>
          <input type="number" placeholder="+/-" style="width:70px;padding:6px;border:1px solid #E2E2E2;border-radius:6px" class="in-ajuste">
          <button class="linkbtn aplicar-ajuste">aplicar</button>
        </td>
      </tr>`).join('');

  t.querySelectorAll('tr[data-id]').forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector('.salvar-preco').addEventListener('click', async () => {
      const preco_centavos = Math.round(Number(tr.querySelector('.in-preco').value) * 100);
      const r = await fetch(`/api/produtos/${id}/preco`, { method: 'POST', headers: H(), body: JSON.stringify({ preco_centavos }) });
      toast(r.ok ? 'Preço atualizado' : 'Erro', r.ok ? 'ok' : 'erro');
    });
    tr.querySelector('.aplicar-ajuste').addEventListener('click', async () => {
      const delta = Math.trunc(Number(tr.querySelector('.in-ajuste').value));
      if (!delta) return toast('Informe + ou - quantidade', 'erro');
      const r = await fetch(`/api/produtos/${id}/ajuste`, { method: 'POST', headers: H(), body: JSON.stringify({ delta, motivo: delta > 0 ? 'entrada' : 'ajuste' }) });
      const d = await r.json();
      if (r.ok) { tr.querySelector('.est').textContent = d.estoque; tr.querySelector('.in-ajuste').value = ''; toast('Estoque ajustado', 'ok'); }
      else toast(d.erro || 'Erro', 'erro');
    });
  });
}

async function carregarPedidos() {
  const pedidos = await fetch('/api/pedidos?limit=100').then((r) => r.json());
  $('#tbl-pedidos').innerHTML = `<tr><th>#</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Pgto</th><th class="num">Total</th><th>Status</th><th></th></tr>` +
    pedidos.map((p) => `
      <tr>
        <td>${p.id}</td><td>${esc(p.created_at)}</td>
        <td>${esc(p.cliente_nome || '')}</td><td>${esc(p.operador || '')}</td>
        <td>${esc(p.forma_pagamento)}${p.pagamento_nsu ? '<br><small>NSU ' + esc(p.pagamento_nsu) + '</small>' : ''}</td>
        <td class="num">${brl(p.total_centavos)}</td>
        <td><span class="tag ${p.status}">${p.status}</span></td>
        <td>
          <a class="linkbtn" href="/api/pedidos/${p.id}/recibo" target="_blank">recibo</a>
          ${p.status === 'pago' ? `<button class="linkbtn cancelar" data-id="${p.id}" style="color:#C0392B">cancelar</button>` : ''}
        </td>
      </tr>`).join('');
  $('#tbl-pedidos').querySelectorAll('.cancelar').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Cancelar pedido #${b.dataset.id}? O estoque será devolvido.`)) return;
    const r = await fetch(`/api/pedidos/${b.dataset.id}/cancelar`, { method: 'POST', headers: H(), body: JSON.stringify({ operador: 'admin' }) });
    if (r.ok) { toast('Pedido cancelado', 'ok'); carregarTudo(); }
    else { const d = await r.json(); toast(d.erro || 'Erro', 'erro'); }
  }));
}

// Downloads precisam do header de PIN -> baixa via blob
async function baixar(url, nome) {
  const r = await fetch(url, { headers: H() });
  if (!r.ok) return toast('Erro no export', 'erro');
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; a.click();
  URL.revokeObjectURL(a.href);
}
$('#exp-sankhya').addEventListener('click', () => baixar('/api/export/sankhya.csv', 'vendas-sankhya.csv'));
$('#exp-clientes').addEventListener('click', () => baixar('/api/export/clientes.csv', 'clientes.csv'));

let tt;
function toast(msg, tipo = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + tipo;
  clearTimeout(tt); tt = setTimeout(() => t.classList.add('hidden'), 2600);
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// auto-login se ja tem PIN na sessao
if (PIN) { $('#login').classList.add('hidden'); $('#painel').classList.remove('hidden'); carregarTudo(); }
