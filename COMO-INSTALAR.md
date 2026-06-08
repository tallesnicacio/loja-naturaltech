# Instalar o PDV da Lojinha (Natural Tech) — passo a passo

Guia para instalar a lojinha **num MacBook**, mesmo sem ninguém da TI por perto.
Leva uns 5–10 minutos. Pode rodar de novo a qualquer momento sem medo.

## Antes de começar
- Um **MacBook** ligado e **com internet** (Wi-Fi normal serve).
- Se já tiver a **impressora térmica** em mãos: **ligue e conecte o cabo USB** no Mac
  antes do passo 3 (se não tiver agora, tudo bem — dá pra configurar depois).

---

## Passo 1 — Abrir o Terminal
1. Aperte **⌘ Command + barra de espaço** (abre a busca do Mac).
2. Digite **Terminal** e aperte **Enter**.
3. Vai abrir uma janela preta/branca com texto. É nela que você cola o comando.

## Passo 2 — Colar o comando e apertar Enter
Copie a linha abaixo **inteira**, cole no Terminal (⌘ Command + V) e aperte **Enter**:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/tallesnicacio/loja-naturaltech/main/scripts/instalar-macos.sh)"
```

A partir daí ele faz tudo sozinho: baixa os programas, o sistema da loja e prepara a impressora.

## Passo 3 — Responder o que ele perguntar
Conforme vai rodando, podem aparecer perguntas. Em geral:

- **"Password:" (senha do Mac)** → é a **senha que você usa pra desbloquear o MacBook**.
  Digite e aperte Enter. ⚠️ As letras **não aparecem** na tela enquanto você digita — é normal.
- **Nome do evento / nome da loja / PIN / largura do papel** → pode só apertar **Enter**
  pra aceitar o que já vem sugerido (entre colchetes). O **PIN** é a senha da tela de Admin.
  Largura do papel: **32** para bobina de **58 mm**, **48** para **80 mm**.
- **"Registrar a impressora térmica USB agora?"** →
  - Se a impressora estiver **ligada e conectada**, responda **s** e siga as instruções.
  - Se ainda não tiver a impressora, responda **N** (ou só Enter) — dá pra configurar depois.
- **"Imprimir um recibo de teste?"** → responda **s** pra conferir se sai papel.
- **"Subir o servidor agora?"** → responda **s** pra já deixar a loja no ar.

## Passo 4 — No final
Quando terminar, ele mostra uma tela de **"Tudo pronto 🎉"** com o **IP do Mac**
(algo como `192.168.0.42`). **Anote esse número.** Nos tablets/celulares, abra no navegador:

- Loja (venda): `http://SEU-IP:3322`
- Separação: `http://SEU-IP:3322/separacao`
- Admin: `http://SEU-IP:3322/admin`

(troque `SEU-IP` pelo número que apareceu).

Para **subir a loja de novo** outro dia: abra o Terminal e rode:
```
cd ~/loja-naturaltech && npm start
```

---

## Se aparecer erro
- **Pediu "Username" e "Password" do GitHub** → avise quem te passou este guia
  (o repositório precisa estar público). Não é a senha do Mac.
- **Travou ou deu erro vermelho** → tire um **print da tela inteira** do Terminal e mande
  pra quem te passou este guia. Não tem problema rodar o comando do Passo 2 de novo —
  ele continua de onde parou e **não apaga vendas nem estoque**.
- O comando pode ser executado **quantas vezes precisar** (é seguro repetir).
