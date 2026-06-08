# Sourçável (não roda sozinho). Popula a variável NODE_BIN com um Node capaz de
# carregar o better-sqlite3 (preferindo node@22) e recompila as dependências se
# nenhum Node disponível carregar o binário. Sai com erro se não houver Node 18–23.
#
# Uso:   source "$(dirname "$0")/escolher-node.sh"   # define $NODE_BIN
#
# Centraliza a lógica usada por iniciar.sh (subir a loja) e resetar-banco.sh
# (re-seed), para não duplicar o tratamento de versão de Node.

# Carrega o better-sqlite3 DE VERDADE: instancia um Database para forçar o dlopen
# do .node — `require` sozinho não toca no binário e dá falso-positivo de ABI.
carrega() { [ -x "$1" ] && "$1" -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1; }

_pick_node() {
  local BREW="" b p f c m

  # Localiza o Homebrew por caminho absoluto (não usa `brew shellenv`, que
  # prepende /opt/homebrew/bin e mascararia o node@22 com uma fórmula `node`).
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && { BREW="$b"; break; }
  done

  # Candidatos, em ordem de preferência: node do PATH, node@22, node@20.
  local CANDS=()
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

  # 2ª passada: nenhum carrega. Pega o melhor candidato com binário pronto
  # (majors 18–23) e reinstala as dependências com ele.
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
}
_pick_node
