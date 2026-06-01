// Backup manual sob demanda: copia o banco para data/backups/.
// Uso: npm run backup   (o servidor ja faz backup automatico enquanto roda)
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_PATH, db } from '../src/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(__dirname, '..', 'data', 'backups');
mkdirSync(dir, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const dest = join(dir, `loja-manual-${ts}.db`);

// db.backup faz copia consistente mesmo com WAL ativo.
await db.backup(dest);
console.log('Backup criado em:', dest);
process.exit(0);
