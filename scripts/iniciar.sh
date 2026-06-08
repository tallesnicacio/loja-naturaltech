#!/usr/bin/env bash
#
# Sobe o servidor da loja com um Node COMPATÍVEL com o better-sqlite3,
# independentemente da versão de Node "global" da máquina.
#
# Por que existe: o better-sqlite3 é um módulo nativo (C++) e só tem binário
# pronto até o Node 23. Em Node 24+ ele precisa compilar e no Node 26 a
# compilação quebra — o servidor então morre com "Could not locate the
# bindings file" / ERR_DLOPEN_FAILED. Como toda a documentação manda rodar
# `npm start`, este wrapper é plugado no `start` (package.json) para que
# `npm start` "sempre funcione", mesmo num Mac com Node 26 instalado.
#
# A escolha do Node fica em escolher-node.sh (compartilhada com resetar-banco.sh).
set -euo pipefail
cd "$(dirname "$0")/.."   # raiz do projeto

source "$(dirname "$0")/escolher-node.sh"   # define $NODE_BIN

echo ">> Iniciando a loja com Node $("$NODE_BIN" -v)"
exec "$NODE_BIN" server.js
