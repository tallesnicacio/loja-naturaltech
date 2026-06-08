#!/usr/bin/env bash
# Duplo-clique neste arquivo (no Finder) para subir a loja.
# Ele chama o bootstrap, que garante um Node compatível antes de iniciar.
cd "$(dirname "$0")"
exec bash scripts/iniciar.sh
