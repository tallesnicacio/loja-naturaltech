import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// DB_FILE permite apontar para um banco descartável em testes, sem tocar no real.
export const DB_PATH = process.env.DB_FILE || join(__dirname, '..', 'data', 'loja.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// WAL: leituras nao bloqueiam escritas. NORMAL: bom equilibrio durabilidade/velocidade.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
// Se o banco estiver travado por outra escrita, espera ate 5s antes de falhar.
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS produtos (
    id              INTEGER PRIMARY KEY,
    sku             TEXT NOT NULL UNIQUE,
    ean             TEXT,
    nome            TEXT NOT NULL,
    categoria       TEXT,
    imagem          TEXT,
    ncm             TEXT,
    codprod_sankhya TEXT,
    preco_centavos  INTEGER NOT NULL DEFAULT 0,
    preco_cheio_centavos INTEGER NOT NULL DEFAULT 0,
    estoque         INTEGER NOT NULL DEFAULT 0,
    ativo           INTEGER NOT NULL DEFAULT 1,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS clientes (
    id          INTEGER PRIMARY KEY,
    cpf         TEXT UNIQUE,
    nome        TEXT NOT NULL,
    email       TEXT,
    telefone    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS pedidos (
    id                  INTEGER PRIMARY KEY,
    cliente_id          INTEGER REFERENCES clientes(id),
    cliente_nome        TEXT,                            -- snapshot no momento da venda
    cliente_cpf         TEXT,                            -- snapshot no momento da venda
    operador            TEXT,
    device              TEXT,
    subtotal_centavos   INTEGER NOT NULL,
    desconto_centavos   INTEGER NOT NULL DEFAULT 0,
    total_centavos      INTEGER NOT NULL,
    forma_pagamento     TEXT NOT NULL,
    pagamento_nsu       TEXT,
    pagamento_bandeira  TEXT,
    status              TEXT NOT NULL DEFAULT 'pago',   -- pago | cancelado
    nf_status           TEXT NOT NULL DEFAULT 'pendente', -- pendente | emitida
    entrega_status      TEXT NOT NULL DEFAULT 'novo',    -- novo | separacao | entregue
    entrega_operador    TEXT,
    entrega_updated_at  TEXT,
    brinde_id           INTEGER,                         -- brinde por faixa de ticket
    brinde_nome         TEXT,                            -- snapshot no momento da venda
    observacao          TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS pedido_itens (
    id                  INTEGER PRIMARY KEY,
    pedido_id           INTEGER NOT NULL REFERENCES pedidos(id),
    produto_id          INTEGER NOT NULL REFERENCES produtos(id),
    sku                 TEXT NOT NULL,
    nome                TEXT NOT NULL,
    preco_unit_centavos INTEGER NOT NULL,
    qtd                 INTEGER NOT NULL,
    total_centavos      INTEGER NOT NULL
  );

  -- Auditoria: TODA mudanca de estoque vira uma linha aqui (rastreabilidade total).
  CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
    id                  INTEGER PRIMARY KEY,
    produto_id          INTEGER NOT NULL REFERENCES produtos(id),
    delta               INTEGER NOT NULL,        -- negativo = saida, positivo = entrada
    estoque_resultante  INTEGER NOT NULL,
    motivo              TEXT NOT NULL,            -- venda | cancelamento | ajuste | entrada
    pedido_id           INTEGER REFERENCES pedidos(id),
    operador            TEXT,
    created_at          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Brindes por faixa de ticket. NAO acumulam: o pedido ganha 1 brinde (a maior faixa atingida).
  CREATE TABLE IF NOT EXISTS brindes (
    id            INTEGER PRIMARY KEY,
    nome          TEXT NOT NULL,
    min_centavos  INTEGER NOT NULL,
    max_centavos  INTEGER,                  -- NULL = sem limite superior ("acima de")
    imagem        TEXT,                     -- foto do brinde (data URL)
    ativo         INTEGER NOT NULL DEFAULT 1,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_itens_pedido ON pedido_itens(pedido_id);
  CREATE INDEX IF NOT EXISTS idx_mov_produto ON movimentacoes_estoque(produto_id);
  CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
`);

// Migracao para bancos criados antes das colunas de vitrine.
const colsProduto = db.prepare('PRAGMA table_info(produtos)').all().map((c) => c.name);
if (!colsProduto.includes('categoria')) db.exec('ALTER TABLE produtos ADD COLUMN categoria TEXT');
if (!colsProduto.includes('imagem')) db.exec('ALTER TABLE produtos ADD COLUMN imagem TEXT');
if (!colsProduto.includes('preco_cheio_centavos')) db.exec('ALTER TABLE produtos ADD COLUMN preco_cheio_centavos INTEGER NOT NULL DEFAULT 0');

// Migracao: fase de entrega/separacao nos pedidos (Kanban de fulfillment).
const colsPedido = db.prepare('PRAGMA table_info(pedidos)').all().map((c) => c.name);
if (!colsPedido.includes('entrega_status')) db.exec("ALTER TABLE pedidos ADD COLUMN entrega_status TEXT NOT NULL DEFAULT 'novo'");
if (!colsPedido.includes('entrega_operador')) db.exec('ALTER TABLE pedidos ADD COLUMN entrega_operador TEXT');
if (!colsPedido.includes('entrega_updated_at')) db.exec('ALTER TABLE pedidos ADD COLUMN entrega_updated_at TEXT');
if (!colsPedido.includes('cliente_nome')) db.exec('ALTER TABLE pedidos ADD COLUMN cliente_nome TEXT');
if (!colsPedido.includes('cliente_cpf')) db.exec('ALTER TABLE pedidos ADD COLUMN cliente_cpf TEXT');
// Backfill do snapshot a partir da tabela clientes (pedidos antigos).
db.exec("UPDATE pedidos SET cliente_nome = (SELECT nome FROM clientes WHERE clientes.id = pedidos.cliente_id) WHERE cliente_nome IS NULL AND cliente_id IS NOT NULL");
db.exec("UPDATE pedidos SET cliente_cpf = (SELECT cpf FROM clientes WHERE clientes.id = pedidos.cliente_id) WHERE cliente_cpf IS NULL AND cliente_id IS NOT NULL");
if (!colsPedido.includes('brinde_id')) db.exec('ALTER TABLE pedidos ADD COLUMN brinde_id INTEGER');
if (!colsPedido.includes('brinde_nome')) db.exec('ALTER TABLE pedidos ADD COLUMN brinde_nome TEXT');
const colsBrinde = db.prepare('PRAGMA table_info(brindes)').all().map((c) => c.name);
if (!colsBrinde.includes('imagem')) db.exec('ALTER TABLE brindes ADD COLUMN imagem TEXT');

// Brindes padrao (so se a tabela estiver vazia) — carregados de data/brindes.json
// (versionado, viaja junto no clone). Depois ficam editaveis no /admin.
if (db.prepare('SELECT COUNT(*) AS n FROM brindes').get().n === 0) {
  const brindesPath = join(__dirname, '..', 'data', 'brindes.json');
  let padrao = [];
  try { if (existsSync(brindesPath)) padrao = JSON.parse(readFileSync(brindesPath, 'utf8')); }
  catch { padrao = []; /* json invalido: comeca sem brindes (cadastra no /admin) */ }
  const insBrinde = db.prepare('INSERT INTO brindes (nome, min_centavos, max_centavos, imagem, ativo) VALUES (?, ?, ?, ?, ?)');
  const carregar = db.transaction((lista) => {
    for (const b of lista) insBrinde.run(b.nome, b.min_centavos, b.max_centavos ?? null, b.imagem ?? null, b.ativo ?? 1);
  });
  carregar(padrao);
}

export default db;
