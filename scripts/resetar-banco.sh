#!/usr/bin/env bash
#
# Reseta o banco da loja para o ORIGINAL (estado de fábrica):
# apaga TODAS as vendas, clientes e movimentações e recria o banco apenas com o
# catálogo + preços + estoque do data/catalogo.csv. Use no PRÉ-EVENTO, depois de
# testar — NUNCA com vendas reais em andamento.
#
# Faz BACKUP automático do banco atual em data/backups/ antes de apagar.
# Para pular a pergunta (automação):  FORCE=1 bash scripts/resetar-banco.sh
# Respeita DB_FILE (banco descartável em testes), igual ao src/db.js.
#
# Uso:  npm run reset   (ou  bash scripts/resetar-banco.sh)
set -euo pipefail
cd "$(dirname "$0")/.."   # raiz do projeto

DB="${DB_FILE:-data/loja.db}"   # mesmo default do src/db.js

B=''; G=''; Y=''; R=''; Z=''
if [ -t 1 ]; then B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; Z=$'\033[0m'; fi

PORT="$(grep -E '^PORT=' .env 2>/dev/null | head -1 | cut -d= -f2-)"; PORT="${PORT:-3322}"

# Quantas vendas existem hoje? (só para avisar o que será perdido)
NPED="?"
if [ -f "$DB" ] && command -v sqlite3 >/dev/null 2>&1; then
  NPED="$(sqlite3 "$DB" 'SELECT COUNT(*) FROM pedidos;' 2>/dev/null || echo '?')"
fi

printf '%s\n' "${R}${B}⚠  RESET DE FÁBRICA DO BANCO${Z}"
printf '   Banco: %s\n' "$DB"
printf '   Isto APAGA pedidos, clientes e movimentações e volta o estoque ao CSV.\n'
printf '   Pedidos no banco agora: %s%s%s\n' "$B" "$NPED" "$Z"
printf '   (Um backup do banco atual será salvo em data/backups/ antes de apagar.)\n\n'

if [ "${FORCE:-0}" != "1" ]; then
  ans=''
  if [ -r /dev/tty ]; then
    printf 'Digite %sRESETAR%s para confirmar (qualquer outra coisa cancela): ' "$B" "$Z" > /dev/tty
    IFS= read -r ans < /dev/tty || ans=''
  fi
  [ "$ans" = "RESETAR" ] || { printf '%sCancelado.%s Nada foi alterado.\n' "$Y" "$Z"; exit 0; }
fi

# 1) para o servidor (libera o arquivo do banco)
lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill 2>/dev/null || true
sleep 1

# 2) backup do banco atual (inclui WAL/SHM, onde podem estar escritas recentes)
ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p data/backups
for f in "$DB" "$DB-wal" "$DB-shm"; do
  [ -f "$f" ] && cp "$f" "data/backups/$(basename "$f").antes-reset-$ts"
done
[ -f "data/backups/$(basename "$DB").antes-reset-$ts" ] \
  && printf '%s✓%s backup salvo: data/backups/%s.antes-reset-%s\n' "$G" "$Z" "$(basename "$DB")" "$ts"

# 3) apaga o banco (db + WAL/SHM)
rm -f "$DB" "$DB-wal" "$DB-shm"

# 4) recria de fábrica com o Node certo (catálogo + preço + estoque do CSV).
#    O src/seed.js respeita DB_FILE, então recria exatamente o $DB apagado acima.
source "$(dirname "$0")/escolher-node.sh"   # define $NODE_BIN
"$NODE_BIN" src/seed.js --reset-estoque

printf '\n%s✓ Banco resetado para o original.%s Suba a loja com: %snpm start%s\n' "$G" "$Z" "$B" "$Z"
