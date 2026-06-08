#!/usr/bin/env bash
#
# Instalador do PDV Natural Tech (TRUE) para macOS.
# Prepara um MacBook "do zero" para virar o servidor da lojinha:
#   Homebrew -> Node 20+ -> git -> clona/atualiza o projeto -> npm install ->
#   .env -> impressora térmica USB no CUPS -> banco (seed) -> teste de impressão.
#
# Como usar (numa máquina nova, COM internet):
#   1) Já clonou o repo?   bash scripts/instalar-macos.sh
#   2) Máquina pelada?     /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/tallesnicacio/loja-naturaltech/main/scripts/instalar-macos.sh)"
#
# É seguro rodar de novo (idempotente): não reinstala o que já existe e
# NUNCA reseta o estoque se o banco já tiver dados.
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/tallesnicacio/loja-naturaltech.git}"
TARGET_DIR="${TARGET_DIR:-$HOME/loja-naturaltech}"
# O better-sqlite3 11.x só tem binário PRONTO (prebuild) até o Node 23. No Node 24+
# ele tenta COMPILAR (precisa de Command Line Tools) e no Node 26 a compilação quebra.
# Por isso fixamos o 22 LTS: instala sem compilar nada.
NODE_FORMULA="${NODE_FORMULA:-node@22}"
NODE_OK_MAJORS=" 18 20 22 23 "   # majors com prebuild do better-sqlite3

# ---------- aparência ----------
if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; Z=$'\033[0m'
else
  B=''; G=''; Y=''; R=''; C=''; Z=''
fi
titulo() { printf '\n%s== %s ==%s\n' "$B$C" "$1" "$Z"; }
ok()     { printf '%s✓%s %s\n' "$G" "$Z" "$1"; }
info()   { printf '  %s\n' "$1"; }
aviso()  { printf '%s!%s %s\n' "$Y" "$Z" "$1"; }
erro()   { printf '%s✗ %s%s\n' "$R" "$1" "$Z" >&2; }
morrer() { erro "$1"; exit 1; }

# Pergunta lendo do terminal real (funciona mesmo via curl | bash).
ask() { # ask <pergunta> <default> -> resposta em $REPLY_ASK
  local p="$1" d="${2:-}" ans=''
  if [ -r /dev/tty ]; then
    if [ -n "$d" ]; then printf '%s [%s]: ' "$p" "$d" > /dev/tty; else printf '%s: ' "$p" > /dev/tty; fi
    IFS= read -r ans < /dev/tty || ans=''
  fi
  REPLY_ASK="${ans:-$d}"
}
confirma() { # confirma <pergunta>  (default Não) -> 0 se sim
  local ans=''
  if [ -r /dev/tty ]; then printf '%s [s/N]: ' "$1" > /dev/tty; IFS= read -r ans < /dev/tty || ans=''; fi
  case "${ans:-}" in [sSyY]*) return 0;; *) return 1;; esac
}

[ "$(uname -s)" = "Darwin" ] || morrer "Este instalador é só para macOS. (uname=$(uname -s))"

printf '%s\n' "$B"
printf '  ┌────────────────────────────────────────────┐\n'
printf '  │   PDV Natural Tech — TRUE  ·  instalador     │\n'
printf '  └────────────────────────────────────────────┘\n'
printf '%s\n' "$Z"

# ---------- 1. Homebrew ----------
titulo "Homebrew"
if ! command -v brew >/dev/null 2>&1; then
  # carrega o brew se já estiver instalado mas fora do PATH
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && eval "$("$b" shellenv)" && break
  done
fi
if ! command -v brew >/dev/null 2>&1; then
  aviso "Homebrew não encontrado — instalando (vai pedir a senha do Mac)."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && eval "$("$b" shellenv)" && break
  done
fi
command -v brew >/dev/null 2>&1 || morrer "Não consegui instalar/encontrar o Homebrew."
ok "brew $(brew --version | head -1 | awk '{print $2}')"

# ---------- 2. git + Node (22 LTS) ----------
titulo "git e Node.js"
command -v git >/dev/null 2>&1 || { info "instalando git..."; brew install git; }
ok "git $(git --version | awk '{print $3}')"

node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }
node_ok()    { command -v node >/dev/null 2>&1 || return 1; case "$NODE_OK_MAJORS" in *" $(node_major) "*) return 0;; *) return 1;; esac; }

if ! node_ok; then
  cur="$(command -v node >/dev/null 2>&1 && node -v || echo nenhum)"
  info "Node atual ($cur) não tem binário pronto do better-sqlite3 — instalando $NODE_FORMULA..."
  brew install "$NODE_FORMULA"
  # node@22 é keg-only: prioriza no PATH desta sessão, mesmo se houver outro node linkado.
  prefix="$(brew --prefix "$NODE_FORMULA" 2>/dev/null || true)"
  [ -n "$prefix" ] && export PATH="$prefix/bin:$PATH"
  hash -r
fi
node_ok || morrer "Não deixei o Node numa versão compatível (tenho: $(node -v 2>/dev/null || echo nenhum)). Instale o Node 22: brew install $NODE_FORMULA"
ok "node $(node -v)  ·  npm $(npm -v)"

# ---------- 3. Código do projeto ----------
titulo "Projeto"
PROJECT_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
  _sd="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; _root="$(dirname "$_sd")"
  grep -q '"loja-naturaltech"' "$_root/package.json" 2>/dev/null && PROJECT_DIR="$_root"
fi
if [ -z "$PROJECT_DIR" ]; then
  if [ -d "$TARGET_DIR/.git" ]; then
    PROJECT_DIR="$TARGET_DIR"
  else
    info "clonando em $TARGET_DIR ..."
    # GIT_TERMINAL_PROMPT=0: se o repo estiver privado, falha na hora em vez de
    # travar o Terminal pedindo usuário/senha do GitHub.
    if ! GIT_TERMINAL_PROMPT=0 git clone "$REPO_URL" "$TARGET_DIR"; then
      erro "Não consegui clonar $REPO_URL"
      info "Se o repositório estiver PRIVADO, o git pede login. Soluções:"
      info "  • deixe o repositório público (Settings → General → Danger Zone), OU"
      info "  • antes de rodar de novo: gh auth login   (instala com 'brew install gh')"
      exit 1
    fi
    PROJECT_DIR="$TARGET_DIR"
  fi
fi
cd "$PROJECT_DIR"
if [ -d .git ]; then
  GIT_TERMINAL_PROMPT=0 git pull --ff-only 2>/dev/null && ok "código atualizado (git pull)" || aviso "git pull pulado (alterações locais, offline ou repo privado) — seguindo com o que está aqui."
fi
# garante o bit de execução dos launchers (zip/download podem perdê-lo)
chmod +x scripts/iniciar.sh "Iniciar Loja.command" 2>/dev/null || true
ok "projeto em $PROJECT_DIR"

# ---------- 4. Dependências ----------
titulo "Dependências (npm)"
npm install || { aviso "Limpando node_modules e reinstalando..."; rm -rf node_modules; npm install; }
# Critério real de sucesso: o módulo nativo carrega NESTA versão do Node. Se um
# install anterior tiver deixado um better-sqlite3 de outro Node (ex.: o 26 que
# falhou), reinstala do zero para baixar o binário certo.
# Instancia um Database :memory: para forçar o dlopen do binário nativo — só
# `require` não valida a ABI (o .node só carrega em `new Database()`).
sqlite_ok() { node -e "new (require('better-sqlite3'))(':memory:').close()" >/dev/null 2>&1; }
if ! sqlite_ok; then
  aviso "better-sqlite3 incompatível com o Node atual — reinstalando do zero..."
  rm -rf node_modules
  npm install
fi
sqlite_ok || morrer "better-sqlite3 não carregou nesta máquina (veja o erro acima)."
ok "node_modules pronto (better-sqlite3 OK)"

# ---------- 5. .env ----------
titulo "Configuração (.env)"
[ -f .env ] || { cp .env.example .env; info ".env criado a partir do exemplo."; }

# set_env CHAVE VALOR  — cria/atualiza a linha no .env (sed do BSD/macOS)
set_env() {
  local k="$1" v="$2"
  if grep -q "^${k}=" .env; then
    local esc; esc="$(printf '%s' "$v" | sed 's/[&/\]/\\&/g')"
    sed -i '' "s/^${k}=.*/${k}=${esc}/" .env
  else
    printf '%s=%s\n' "$k" "$v" >> .env
  fi
}
get_env() { grep "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2-; }

set_env RECEIPT_MODE cups
ask "Nome do evento (topo do PDV/recibo)" "$(get_env EVENT_NAME)"; set_env EVENT_NAME "$REPLY_ASK"
ask "Nome da loja no recibo (STORE_NAME)" "$(get_env STORE_NAME)"; set_env STORE_NAME "$REPLY_ASK"
ask "PIN do Admin (4 dígitos)"            "$(get_env ADMIN_PIN)";  set_env ADMIN_PIN  "$REPLY_ASK"
ask "Largura do papel — 32 (58mm) ou 48 (80mm)" "$(get_env PRINTER_COLS)"; set_env PRINTER_COLS "$REPLY_ASK"
ok ".env configurado (RECEIPT_MODE=cups)"

# ---------- 6. Impressora térmica USB (CUPS) ----------
titulo "Impressora térmica (USB / CUPS)"
atual="$(get_env PRINTER_CUPS_NAME)"
if [ -n "$atual" ] && lpstat -p "$atual" >/dev/null 2>&1; then
  ok "fila já configurada e ativa: $atual"
else
  info "Filas CUPS já instaladas:"
  lpstat -p 2>/dev/null | awk '/^printer/{print "    - "$2}' || true
  echo
  if confirma "Registrar/configurar a impressora térmica USB agora? (precisa estar ligada e conectada)"; then
    info "Procurando impressoras USB... (pode pedir a senha do Mac)"
    # bash 3.2 (padrão do macOS) não tem mapfile — popula o array no laço.
    URIS=()
    while IFS= read -r _u; do [ -n "$_u" ] && URIS+=("$_u"); done \
      < <(sudo lpinfo -v 2>/dev/null | awk '/usb:\/\//{print $2}')
    URI=""
    if [ "${#URIS[@]}" -eq 1 ]; then
      URI="${URIS[0]}"; info "encontrada: $URI"
    elif [ "${#URIS[@]}" -gt 1 ]; then
      info "Várias impressoras USB encontradas:"; i=1
      for u in "${URIS[@]}"; do printf '    %d) %s\n' "$i" "$u"; i=$((i+1)); done
      ask "Escolha o número" "1"; idx="$REPLY_ASK"
      case "$idx" in *[!0-9]*|'') idx=1;; esac; [ "$idx" -ge 1 ] || idx=1
      URI="${URIS[$((idx-1))]:-${URIS[0]}}"
    else
      aviso "Nenhuma impressora USB detectada. Ligue/conecte e rode o instalador de novo."
      ask "Ou cole o URI manualmente (ex.: usb://YICHIP/...) — vazio para pular" ""
      URI="$REPLY_ASK"
    fi
    if [ -n "$URI" ]; then
      ask "Nome da fila (sem espaços)" "POS58"; NAME="$REPLY_ASK"
      # fila RAW: o servidor manda ESC/POS cru com 'lp -o raw', sem o CUPS reinterpretar.
      if sudo lpadmin -p "$NAME" -E -v "$URI" -m raw 2>/dev/null \
         || sudo lpadmin -p "$NAME" -E -v "$URI" -o printer-is-shared=false; then
        sudo cupsenable "$NAME" 2>/dev/null || true
        sudo cupsaccept "$NAME" 2>/dev/null || true
        set_env PRINTER_CUPS_NAME "$NAME"
        ok "impressora registrada: $NAME → $URI"
      else
        erro "lpadmin falhou. Configure manualmente (lpadmin -p NOME -E -v \"$URI\")."
      fi
    fi
  else
    aviso "Impressora pulada. Depois preencha PRINTER_CUPS_NAME no .env (veja 'lpstat -p')."
  fi
fi

# ---------- 7. Banco (seed) ----------
titulo "Banco de dados (catálogo + estoque)"
if [ -f data/loja.db ]; then
  aviso "Já existe data/loja.db — NÃO vou resetar o estoque (pode haver vendas)."
  info "Sincronizando catálogo preservando o saldo atual..."
  npm run seed
else
  info "Banco novo: gravando catálogo, preços e estoque do CSV."
  npm run seed:reset-estoque
fi
ok "banco pronto"

# ---------- 8. Teste de impressão (opcional) ----------
PNAME="$(get_env PRINTER_CUPS_NAME)"
if [ -n "$PNAME" ] && lpstat -p "$PNAME" >/dev/null 2>&1; then
  titulo "Teste de impressão"
  if confirma "Imprimir um recibo de teste em '$PNAME' agora?"; then
    {
      printf '\x1b@'; printf '\x1ba\x01'; printf '\x1bE\x01'
      printf 'TESTE PDV NATURAL TECH\n'; printf '\x1bE\x00'
      printf 'Impressora OK\n'; printf '%s\n' "$(date '+%d/%m/%Y %H:%M')"
      printf '\x1ba\x00'; printf -- '--------------------------------\n'
      printf '\n\n\n'; printf '\x1dV\x42\x00'
    } | lp -d "$PNAME" -o raw >/dev/null 2>&1 \
      && ok "enviado — confira o papel." \
      || erro "falha ao enviar para a impressora."
  fi
fi

# ---------- 9. Pronto ----------
PORT="$(get_env PORT)"; PORT="${PORT:-3322}"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
titulo "Tudo pronto 🎉"
info "Pasta do projeto:  $PROJECT_DIR"
[ -n "$IP" ] && info "IP deste Mac:      $IP   (fixe no roteador / DHCP reservation)"
echo
info "Para subir o servidor:   ${B}cd \"$PROJECT_DIR\" && npm start${Z}"
info "Ou: duplo-clique em ${B}Iniciar Loja.command${Z} dentro da pasta do projeto (Finder)."
[ -n "$IP" ] && {
  info "Tablets (venda):   http://$IP:$PORT"
  info "Separação:         http://$IP:$PORT/separacao"
  info "Admin:             http://$IP:$PORT/admin"
}
echo
if confirma "Subir o servidor agora (npm start)?"; then exec npm start; fi
ok "Quando quiser, rode 'npm start' na pasta do projeto. Bom evento!"
