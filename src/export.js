// Exports pos-evento: vendas para emissao de NF no Sankhya, e clientes para o CRM.
import { db } from './db.js';

function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCSV(rows, header) {
  const linhas = [header.join(';')];
  for (const r of rows) linhas.push(header.map((h) => csvEscape(r[h])).join(';'));
  return linhas.join('\n');
}
const reais = (c) => (Number(c || 0) / 100).toFixed(2).replace('.', ',');

// Uma linha por ITEM de pedido pago -> base para gerar NF no Sankhya.
export function exportVendasSankhya() {
  const rows = db.prepare(`
    SELECT
      p.id              AS pedido,
      p.created_at      AS data_hora,
      p.status          AS status,
      p.forma_pagamento AS forma_pagamento,
      p.pagamento_nsu   AS nsu_autorizacao,
      p.operador        AS vendedor,
      p.cliente_cpf     AS cpf,
      p.cliente_nome    AS cliente,
      c.email           AS email,
      c.telefone        AS telefone,
      i.sku             AS sku,
      pr.codprod_sankhya AS codprod_sankhya,
      pr.ncm            AS ncm,
      i.nome            AS produto,
      i.qtd             AS qtd,
      i.preco_unit_centavos AS preco_unit_c,
      i.total_centavos  AS total_item_c,
      p.total_centavos  AS total_pedido_c
    FROM pedido_itens i
    JOIN pedidos p  ON p.id = i.pedido_id
    JOIN produtos pr ON pr.id = i.produto_id
    LEFT JOIN clientes c ON c.id = p.cliente_id
    WHERE p.status = 'pago'
    ORDER BY p.id, i.id
  `).all().map((r) => ({
    ...r,
    preco_unit: reais(r.preco_unit_c),
    total_item: reais(r.total_item_c),
    total_pedido: reais(r.total_pedido_c),
  }));

  const header = [
    'pedido', 'data_hora', 'status', 'cpf', 'cliente', 'email', 'telefone',
    'sku', 'codprod_sankhya', 'ncm', 'produto', 'qtd', 'preco_unit', 'total_item',
    'forma_pagamento', 'nsu_autorizacao', 'vendedor', 'total_pedido',
  ];
  return toCSV(rows, header);
}

// Clientes unicos para importar no Klaviyo/CRM.
export function exportClientes() {
  const rows = db.prepare(`
    SELECT c.nome, c.email, c.telefone, c.cpf,
           COUNT(p.id)                       AS pedidos,
           COALESCE(SUM(p.total_centavos),0) AS gasto_c,
           MIN(p.created_at)                 AS primeira_compra
    FROM clientes c
    LEFT JOIN pedidos p ON p.cliente_id = c.id AND p.status = 'pago'
    GROUP BY c.id
    ORDER BY c.nome
  `).all().map((r) => ({
    nome: r.nome, email: r.email, telefone: r.telefone, cpf: r.cpf,
    pedidos: r.pedidos, total_gasto: reais(r.gasto_c),
    primeira_compra: r.primeira_compra, origem: 'Natural Tech',
  }));
  const header = ['nome', 'email', 'telefone', 'cpf', 'pedidos', 'total_gasto', 'primeira_compra', 'origem'];
  return toCSV(rows, header);
}
