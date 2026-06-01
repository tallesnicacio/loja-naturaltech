// Carrega data/catalogo.csv -> tabela produtos (idempotente).
//
//   node src/seed.js                 -> cria novos produtos; em existentes atualiza
//                                       nome/preco/ean/ncm/codprod MAS preserva o estoque.
//   node src/seed.js --reset-estoque -> tambem sobrescreve o estoque pelo valor do CSV.
//
// Regra: durante o evento NUNCA rode com --reset-estoque (sobrescreveria o saldo real).
// TRAVA: se ja existir QUALQUER pedido no banco, --reset-estoque e BLOQUEADO (exige --force).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, '..', 'data', 'catalogo.csv');
const resetEstoque = process.argv.includes('--reset-estoque');

// Parser CSV minimo com suporte a campos entre aspas.
function parseCSV(texto) {
  const linhas = texto.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim() !== '');
  const header = splitLinha(linhas[0]);
  return linhas.slice(1).map((linha) => {
    const cols = splitLinha(linha);
    const obj = {};
    header.forEach((h, i) => { obj[h.trim()] = (cols[i] ?? '').trim(); });
    return obj;
  });
}

function splitLinha(linha) {
  const out = [];
  let atual = '';
  let dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') { dentroAspas = !dentroAspas; continue; }
    if (c === ',' && !dentroAspas) { out.push(atual); atual = ''; continue; }
    atual += c;
  }
  out.push(atual);
  return out;
}

function precoParaCentavos(valor) {
  if (!valor) return 0;
  const limpo = String(valor).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const num = Number(valor.includes(',') ? limpo : valor); // aceita "29,90" e "29.90"
  return Math.round((Number.isFinite(num) ? num : 0) * 100);
}

const registros = parseCSV(readFileSync(CSV_PATH, 'utf8'));

const existente = db.prepare('SELECT id, estoque FROM produtos WHERE sku = ?');
const inserir = db.prepare(`
  INSERT INTO produtos (sku, ean, nome, categoria, imagem, ncm, codprod_sankhya, preco_centavos, preco_cheio_centavos, estoque)
  VALUES (@sku, @ean, @nome, @categoria, @imagem, @ncm, @codprod_sankhya, @preco_centavos, @preco_cheio_centavos, @estoque)
`);
const atualizar = db.prepare(`
  UPDATE produtos
     SET ean=@ean, nome=@nome, categoria=@categoria, imagem=@imagem, ncm=@ncm,
         codprod_sankhya=@codprod_sankhya, preco_centavos=@preco_centavos,
         preco_cheio_centavos=@preco_cheio_centavos, estoque=@estoque,
         updated_at=datetime('now','localtime')
   WHERE sku=@sku
`);

let criados = 0, atualizados = 0;

const rodar = db.transaction(() => {
  for (const r of registros) {
    const sku = r.sku;
    if (!sku) continue;
    const atual = existente.get(sku);
    const linha = {
      sku,
      ean: r.ean || null,
      nome: r.nome,
      categoria: r.categoria || null,
      imagem: r.imagem || null,
      ncm: r.ncm || null,
      codprod_sankhya: r.codprod_sankhya || null,
      preco_centavos: precoParaCentavos(r.preco),
      preco_cheio_centavos: precoParaCentavos(r.preco_cheio),
      // estoque novo: usa CSV. existente: preserva, exceto se --reset-estoque
      estoque: atual && !resetEstoque ? atual.estoque : Number(r.estoque || 0),
    };
    if (atual) { atualizar.run(linha); atualizados++; }
    else { inserir.run(linha); criados++; }
  }
});

// ---- TRAVA DE SEGURANCA: nao sobrescrever estoque com vendas em andamento ----
if (resetEstoque && !process.argv.includes('--force')) {
  const nped = db.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n;
  if (nped > 0) {
    console.error(`\n  ⛔ BLOQUEADO: ha ${nped} pedido(s) no banco (evento em andamento?).`);
    console.error('  --reset-estoque sobrescreveria o estoque atual das vendas.');
    console.error('  Se for REALMENTE o que voce quer, rode de novo com --force.');
    console.error('  (Este comando nunca apaga pedidos; so atualiza catalogo/estoque.)\n');
    process.exit(1);
  }
}

rodar();

console.log(`Catalogo sincronizado: ${criados} criado(s), ${atualizados} atualizado(s).`);
if (resetEstoque) console.log('Estoque foi RESETADO pelos valores do CSV.');
else console.log('Estoque dos produtos existentes foi preservado.');
