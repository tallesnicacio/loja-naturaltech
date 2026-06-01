'use strict';
// Mascaras (CPF/telefone) + consulta de cliente por CPF (autofill).
// Compartilhado pela Loja (totem) e pelo PDV. Form: #c-cpf #c-nome #c-email #c-tel.
(function () {
  const $ = (s) => document.querySelector(s);
  const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
  const cpf = $('#c-cpf'), nome = $('#c-nome'), email = $('#c-email'), tel = $('#c-tel');
  if (!cpf) return;

  function cpfValido(v) {
    const c = onlyDigits(v);
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
    let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0; if (d1 !== +c[9]) return false;
    s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
    let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0; return d2 === +c[10];
  }
  function mascaraCPF(v) {
    return onlyDigits(v).slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  function mascaraTel(v) {
    const d = onlyDigits(v).slice(0, 11);
    if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
  }
  const fire = (el) => el.dispatchEvent(new Event('input', { bubbles: true }));

  let ultimo = '';
  async function buscar(d) {
    if (d === ultimo) return;
    ultimo = d;
    try {
      const r = await fetch('/api/clientes/' + d);
      if (!r.ok) return;                       // 404 = cliente novo, segue manual
      const c = await r.json();
      if (nome) { nome.value = c.nome || ''; fire(nome); }
      if (email && c.email) email.value = c.email;
      if (tel && c.telefone) tel.value = c.telefone;
      if (window.toast) {
        const n = c.pedidos ? ` · ${c.pedidos} compra${c.pedidos > 1 ? 's' : ''}` : '';
        window.toast(`Cliente reconhecido: ${c.nome}${n}`, 'ok');
      }
    } catch { /* offline: preenche manual */ }
  }

  cpf.addEventListener('input', () => {
    cpf.value = mascaraCPF(cpf.value);
    const d = onlyDigits(cpf.value);
    if (d.length < 11) { ultimo = ''; return; }
    if (cpfValido(d)) buscar(d);
  });
  if (tel) tel.addEventListener('input', () => { tel.value = mascaraTel(tel.value); });
  if (email) email.addEventListener('blur', () => { email.value = email.value.trim().toLowerCase(); });
})();
