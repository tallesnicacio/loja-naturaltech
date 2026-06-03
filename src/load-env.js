// Carrega o .env ANTES de qualquer outro modulo. Deve ser o PRIMEIRO import do
// server.js: como os imports ESM rodam antes do corpo do modulo, se o .env for
// carregado so no corpo (ex.: process.loadEnvFile() la embaixo), modulos importados
// como print.js ja terao lido suas env vars (PRINTER_COLS, STORE_NAME, ...) no
// load-time com os defaults errados. Node 20.12+/21.7+. Silencioso se nao houver .env.
try { process.loadEnvFile(); } catch { /* sem .env: usa defaults */ }
