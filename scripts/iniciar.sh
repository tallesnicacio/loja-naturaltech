#!/usr/bin/env bash
#
# Sobe o servidor da loja com um Node COMPATÍVEL com o better-sqlite3,
# independentemente da versão de Node "global" da máquina.
#
# Por que existe: o better-sqlite3 é um módulo nativo (C++) e só tem binário
# pronto até o Node 23. Em Node 24+ ele precisa compilar e no Node 26 a
# compilação quebra — o servidor então morre com "Could not locate the
# bindings file". Como toda a documentação manda rodar `npm start`, este
# wrapper é plugado no `start` (package.json) para que `npm start` "sempre
# funcione", mesmo num Mac com Node 26 instalado.
#
# É cirúrgico: se o Node atual já carrega o módulo, usa ele e não mexe em nada.
# Só troca de Node / recompila quando o atual está quebrado.
set -euo pipefail
cd "$(dirname "$0")/.."   # raiz do projeto

# Testa se o better-sqlite3 carrega DE VERDADE neste Node. Precisa INSTANCIAR um
# Database: `require('better-sqlite3')` sozinho NÃO toca no binário nativo — o
# dlopen do .node só acontece em `new Database()`. Um require seco dá
# falso-positivo mesmo com ABI incompatível. Abrir um banco :memory: força o load.
carrega() { [ -x "$1" ] && "$1" -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1; }

# Localiza o Homebrew SEM mexer no PATH. `brew shellenv` prepende /opt/homebrew/bin,
# e se houver uma fórmula `node` linkada lá (ex.: Node 26) ela mascararia o node@22.
BREW=""
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  [ -x "$b" ] && { BREW="$b"; break; }
done

# Candidatos a Node, em ordem de preferência:
#  1) o node do PATH (não mexe no que já funciona)
#  2) node@22 LTS do Homebrew (binário pronto do better-sqlite3)
#  3) node@20 do Homebrew
CANDS=()
command -v node >/dev/null 2>&1 && CANDS+=("$(command -v node)")
for f in node@22 node@20; do
  [ -n "$BREW" ] || break
  p="$("$BREW" --prefix "$f" 2>/dev/null || true)/bin/node"
  [ -x "$p" ] && CANDS+=("$p")
done
[ "${#CANDS[@]}" -gt 0 ] || { echo "Node não encontrado. Rode: bash scripts/instalar-macos.sh"; exit 1; }

# 1ª passada: algum candidato que JÁ carrega o módulo nativo? usa direto.
NODE_BIN=""
for c in "${CANDS[@]}"; do carrega "$c" && { NODE_BIN="$c"; break; }; done

# 2ª passada: nenhum carrega (node_modules ausente ou compilado p/ outro Node).
# Pega o melhor candidato com binário pronto (majors 18–23) e reinstala com ele.
if [ -z "$NODE_BIN" ]; then
  for c in "${CANDS[@]}"; do
    m="$("$c" -v | sed 's/^v//' | cut -d. -f1)"
    case " 18 20 22 23 " in *" $m "*) NODE_BIN="$c"; break;; esac
  done
  [ -n "$NODE_BIN" ] || { echo "Nenhum Node 18–23 disponível. Rode: bash scripts/instalar-macos.sh"; exit 1; }
  echo ">> Ajustando dependências para o Node $("$NODE_BIN" -v) (better-sqlite3)…"
  rm -rf node_modules
  "$(dirname "$NODE_BIN")/npm" install
  carrega "$NODE_BIN" || { echo "better-sqlite3 ainda não carregou. Rode: bash scripts/instalar-macos.sh"; exit 1; }
fi

echo ">> Iniciando a loja com Node $("$NODE_BIN" -v)"
exec "$NODE_BIN" server.js
