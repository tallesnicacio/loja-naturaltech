# PDV Natural Tech — TRUE

Ponto de venda **offline** para a feira Natural Tech. Um notebook roda o servidor + banco
(SQLite); os tablets dos promotores acessam pelo navegador numa **rede local sem internet**.
O estoque é controlado de forma **transacional** no servidor — não há risco de vender o mesmo
item duas vezes mesmo com várias vendas simultâneas.

## Arquitetura

```
        [Roteador WiFi — SEM internet]
                    │
   ┌────────┬───────┼────────┬─────────────┐
[Tablet 1][Tablet 2][Tablet 3]      [NOTEBOOK = servidor]
 (navegador / PWA)                   Node.js + SQLite + impressora térmica
                                     estoque · pedidos · clientes
```

- **Servidor (notebook):** Node.js + Express + better-sqlite3. Única fonte de verdade do estoque.
- **Tablets:** abrem `http://<IP-do-notebook>:3322` no navegador (Chrome/Safari). Dá pra
  "Adicionar à tela de início" (PWA) para virar um app em tela cheia.
- **Concorrência:** cada venda roda numa transação `UPDATE ... WHERE estoque >= qtd`. Se duas
  vendas disputam a última unidade, uma conclui e a outra recebe "esgotado". Impossível furar.
- **Auditoria:** toda mudança de estoque (venda, cancelamento, ajuste, entrada) é registrada na
  tabela `movimentacoes_estoque`.

## As três telas

| Tela | URL | Para quê |
|------|-----|----------|
| **Loja / totem** | `/` | Cliente monta o pedido; o promotor finaliza informando pagamento e NSU. |
| **Separação** | `/separacao` | Painel kanban (novo → em separação → entregue) com **alerta sonoro** quando entra pedido novo. Pede o nome do conferente ao abrir. |
| **Admin** | `/admin` | Dashboard de vendas, estoque (+/-), cancelamento, exports e reimpressão. Protegido por `ADMIN_PIN`. |

## Pré-requisitos
- **Node.js 22 LTS** (recomendado). O `better-sqlite3` tem binário pronto só até o Node 23;
  no **Node 24+** ele precisa compilar (exige Command Line Tools) e no **Node 26** a
  compilação falha. O instalador automático já fixa o 22. `node --version`
- `git` (para clonar/atualizar). `git --version`

## Instalação numa máquina NOVA da feira (clonando do GitHub)

> Faça **com internet** (antes do evento).

### Jeito fácil — instalador automático (macOS)
Um script cuida de tudo: instala **Homebrew**, **Node 20+** e **git**, clona o projeto,
roda `npm install`, monta o `.env` (perguntando PIN, nome da loja e largura do papel),
**registra a impressora térmica USB no CUPS**, cria o banco com o catálogo e ainda
imprime um recibo de teste. Numa máquina pelada, cole no **Terminal**:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/tallesnicacio/loja-naturaltech/main/scripts/instalar-macos.sh)"
```

Se o repositório **já está clonado**, rode de dentro dele: `bash scripts/instalar-macos.sh`.
É **idempotente** (pode rodar de novo sem medo) e **nunca reseta o estoque** se o banco
já tiver vendas. No fim ele mostra o IP do Mac e as URLs dos tablets.

### Manual (passo a passo)
> Precisa de **Node.js 20+** e **git**.

```bash
git clone https://github.com/tallesnicacio/loja-naturaltech.git
cd loja-naturaltech
npm install                  # dependências (com Node 22, better-sqlite3 vem pré-compilado)
cp .env.example .env         # ajuste ADMIN_PIN, impressora, etc.
npm run seed:reset-estoque   # cria o banco com catálogo + preço + estoque do CSV
npm start                    # sobe o servidor; o banner mostra o IP de acesso
```

Catálogo (`data/catalogo.csv`) e **fotos dos produtos** (`public/img/`) já vêm no repositório.
O banco (`data/loja.db`), o `.env` e os backups **não** vão pro Git — cada máquina tem o seu.

**Atualizar** uma máquina depois:
```bash
git pull
npm install   # se houver dependência nova
# NÃO rode seed:reset-estoque se já houver vendas (está travado; exige --force)
```

## Preencher preços e quantidades
Edite `data/catalogo.csv` (colunas `preco` e `estoque`) e rode:

```bash
npm run seed:reset-estoque   # USAR SÓ no pré-evento: grava preço E estoque do CSV
```

> Durante o evento **nunca** use `--reset-estoque` (ele sobrescreveria o saldo real).
> Para repor estoque no meio do evento, use a tela **Admin → Estoque → aplicar (+/-)**.
> Preços também podem ser ajustados pelo Admin sem mexer no CSV.

## Rodar (no dia)

```bash
npm start
```

A saída mostra a porta (padrão **3322**) e o IP de acesso. Para descobrir o IP do notebook:
- macOS: `ipconfig getifaddr en0` (ou veja em Ajustes → Wi-Fi)

Nos aparelhos da feira:
- Tablets (venda): `http://<IP-do-notebook>:3322`
- Separação: `http://<IP-do-notebook>:3322/separacao`
- Admin: `http://<IP-do-notebook>:3322/admin`

## Rede do evento (importante)
- Use um **roteador WiFi dedicado** (não depende de internet). Ligue o notebook nele (cabo ou WiFi).
- Fixe o IP do notebook (DHCP reservation no roteador) para a URL dos tablets não mudar.
- Desligue o "isolamento de clientes" do WiFi (senão um aparelho não enxerga o outro).
- O hotspot do celular/notebook funciona, mas é instável e limita conexões — prefira o roteador.

## Pagamento (maquininha física)
O sistema **não** integra com a maquininha. Fluxo: passe o cartão na maquininha → ao finalizar a
venda no tablet, escolha a forma de pagamento e digite o **NSU/código de autorização** (para
conciliar depois com o extrato da adquirente). Pix/dinheiro não pedem NSU.

## Comprovante térmico (ESC/POS)
O recibo é **não-fiscal** e impresso **direto pelo servidor** numa impressora térmica (o antigo
recibo HTML/AirPrint foi removido). As mesmas vias saem ao finalizar a venda e pelo botão
**imprimir** nas telas de Admin e Separação. Configure no `.env`:

- `RECEIPT_MODE=cups` — impressora **USB local** registrada no CUPS (macOS/Linux). Defina
  `PRINTER_CUPS_NAME` com o nome exato da fila (descubra com `lpstat -p`). **É o modo usado na feira.**
- `RECEIPT_MODE=network` — impressora térmica **de rede** (TCP 9100). Defina `PRINTER_HOST` (IP) e
  `PRINTER_PORT` (9100).
- `PRINTER_COLS` — largura do papel em colunas: **32 para 58 mm**, **48 para 80 mm**. ⚠️ Errar esse
  valor desconfigura as quebras de linha do recibo.
- `STORE_NAME` e `STORE_CNPJ` aparecem no cabeçalho do recibo.

## Brindes
A loja oferece **brindes por faixa de valor**: quando o pedido atinge o valor mínimo de um brinde,
ele é concedido automaticamente, aparece no recibo e na tela de separação. A loja mostra um banner
lembrando os brindes ativos (imagem estática ou faixa dinâmica a partir dos brindes cadastrados).

## Nota fiscal (pós-evento)
As notas **não** são emitidas na hora. O sistema captura todos os dados fiscais (produto, SKU,
quantidade, preço, CPF/nome do cliente). Depois do evento, com internet:

- **Admin → Exportar vendas (Sankhya)** gera `vendas-sankhya.csv` (1 linha por item, com CPF, SKU,
  `codprod_sankhya`, NCM, qtd, valores, forma de pagamento e NSU) para importar/emitir no Sankhya.
- **Admin → Exportar clientes (CRM)** gera `clientes.csv` para subir no Klaviyo.

> Para casar 100% com o Sankhya, preencha no `catalogo.csv` as colunas `codprod_sankhya` e `ncm`
> (código do produto no ERP e NCM). Sem isso o export sai com SKU interno e o fiscal mapeia na mão.

## Backup (à prova de susto)
- O servidor faz **backup automático** do banco a cada `BACKUP_INTERVAL_MIN` minutos em
  `data/backups/` (mantém os últimos `BACKUP_KEEP`). O banco é um único arquivo (`data/loja.db`).
- Backup manual: `npm run backup`.
- **Recomendado:** copie `data/backups/` para um pendrive de tempos em tempos. Tenha um 2º notebook
  com o projeto já instalado como reserva.

## Variáveis de ambiente (`.env`)

| Variável | Padrão | Função |
|----------|--------|--------|
| `PORT` | `3322` | porta do servidor local |
| `EVENT_NAME` | `Natural Tech - TRUE` | nome no topo do PDV e no recibo |
| `ADMIN_PIN` | `1234` | PIN da tela Admin |
| `BACKUP_INTERVAL_MIN` | `5` | intervalo do backup automático (`0` desativa) |
| `BACKUP_KEEP` | `50` | quantos backups manter |
| `RECEIPT_MODE` | `browser` | impressão térmica: use `cups` (USB) ou `network` (TCP 9100) |
| `PRINTER_CUPS_NAME` | — | nome exato da fila CUPS (modo `cups`) — veja `lpstat -p` |
| `PRINTER_HOST` / `PRINTER_PORT` | — / `9100` | impressora de rede (modo `network`) |
| `PRINTER_COLS` | `48` | colunas do papel: `32` (58 mm) / `48` (80 mm) |
| `STORE_NAME` / `STORE_CNPJ` | `TRUE` / — | emitente impresso no recibo |

> O `.env` é carregado por `src/load-env.js`, importado como **primeiro módulo** do `server.js`,
> antes de qualquer outro `import` ler suas variáveis (ESM executa os imports antes do corpo).

## Checklist do dia
1. [ ] Notebook carregado / na tomada + nobreak ou powerbank.
2. [ ] Roteador ligado, IP do notebook fixado, "isolamento de clientes" desligado.
3. [ ] `npm start` rodando; **testar 1 venda de ponta a ponta** (incluindo a impressão do recibo).
4. [ ] Conferir preços e estoques no Admin.
5. [ ] Tablets conectados na rede e na URL certa (`:3322`); testar em cada um.
6. [ ] Tela de **Separação** aberta com nome do conferente; som de alerta funcionando.
7. [ ] Impressora térmica ligada, com papel, e `PRINTER_COLS` batendo com o papel (58 mm → 32).
8. [ ] Maquininha(s) carregada(s); promotores sabem digitar o NSU.
9. [ ] Pendrive de backup à mão.

## Estrutura
```
server.js            API + criação de pedido transacional + backup automático
src/load-env.js      carrega o .env antes dos demais módulos (1º import do server.js)
src/db.js            SQLite (WAL) + schema + auditoria de estoque
src/seed.js          carrega data/catalogo.csv → produtos
src/print.js         recibo térmico ESC/POS (CUPS USB ou rede TCP 9100)
src/export.js        export Sankhya (NF) e clientes (CRM)
public/              Loja (/), Separação (/separacao), Admin (/admin), CSS (tokens TRUE), PWA
data/catalogo.csv    catálogo (você preenche preço/estoque)
data/loja.db         banco SQLite (gerado; não versionar)
scripts/backup.js    backup manual
```
