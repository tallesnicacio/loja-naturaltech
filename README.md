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
 (navegador / PWA)                   Node.js + SQLite
                                     estoque · pedidos · clientes
```

- **Servidor (notebook):** Node.js + Express + better-sqlite3. Única fonte de verdade do estoque.
- **Tablets:** só abrem `http://<IP-do-notebook>:3000` no navegador (Chrome/Safari). Dá pra
  "Adicionar à tela de início" (PWA) para virar um app em tela cheia.
- **Concorrência:** cada venda roda numa transação `UPDATE ... WHERE estoque >= qtd`. Se duas
  vendas disputam a última unidade, uma conclui e a outra recebe "esgotado". Impossível furar.
- **Auditoria:** toda mudança de estoque (venda, cancelamento, ajuste, entrada) é registrada na
  tabela `movimentacoes_estoque`.

## Pré-requisitos
- Node.js 20+ (testado no 24). `node --version`
- `git` (para clonar/atualizar). `git --version`

## Instalação numa máquina NOVA da feira (clonando do GitHub)

> Faça **com internet** (antes do evento). Precisa de **Node.js 20+** e **git**.

```bash
git clone https://github.com/tallesnicacio/loja-naturaltech.git
cd loja-naturaltech
npm install                  # dependências (better-sqlite3 vem pré-compilado)
cp .env.example .env         # no Windows: copy .env.example .env  — ajuste ADMIN_PIN, etc.
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

## Instalação (fazer ANTES do evento, com internet)

```bash
npm install            # instala dependências (faça com internet!)
cp .env.example .env   # ajuste PORT, ADMIN_PIN, nome do evento, impressora
npm run seed           # carrega os 25 produtos de data/catalogo.csv
```

### Preencher preços e quantidades
Edite `data/catalogo.csv` (colunas `preco` e `estoque`) e rode:

```bash
npm run seed:reset-estoque   # USAR SÓ no pré-evento: grava preço E estoque do CSV
```

> Durante o evento **nunca** use `--reset-estoque` (ele sobrescreveria o saldo real).
> Para repor estoque no meio do evento, use a tela **Admin → Estoque → aplicar (+/-)**.
> Preços também podem ser ajustados pelo Admin sem mexer no CSV.

Dica: você também pode preencher preço/estoque pela tela de Admin depois de subir o servidor.

## Rodar (no dia)

```bash
npm start
```

Saída mostra a porta. Descubra o IP do notebook na rede:
- macOS: `ipconfig getifaddr en0` (ou veja em Ajustes → Wi-Fi)

Nos tablets, abra: `http://<IP-do-notebook>:3000`
Admin (dashboard, estoque, exports): `http://<IP-do-notebook>:3000/admin`

## Rede do evento (importante)
- Use um **roteador WiFi dedicado** (não depende de internet). Ligue o notebook nele (cabo ou WiFi).
- Fixe o IP do notebook (DHCP reservation no roteador) para a URL dos tablets não mudar.
- O hotspot do celular/notebook funciona, mas é instável e limita conexões — prefira o roteador.

## Pagamento (maquininha física)
O sistema **não** integra com a maquininha. Fluxo: passe o cartão na maquininha → ao finalizar a
venda no tablet, escolha a forma de pagamento e digite o **NSU/código de autorização** (para
conciliar depois com o extrato da adquirente). Pix/dinheiro não pedem NSU.

## Nota fiscal (pós-evento)
As notas **não** são emitidas na hora. O sistema captura todos os dados fiscais (produto, SKU,
quantidade, preço, CPF/nome do cliente). Depois do evento, com internet:

- **Admin → Exportar vendas (Sankhya)** gera `vendas-sankhya.csv` (1 linha por item, com CPF, SKU,
  `codprod_sankhya`, NCM, qtd, valores, forma de pagamento e NSU) para importar/emitir no Sankhya.
- **Admin → Exportar clientes (CRM)** gera `clientes.csv` para subir no Klaviyo.

> Para casar 100% com o Sankhya, preencha no `catalogo.csv` as colunas `codprod_sankhya` e `ncm`
> (código do produto no ERP e NCM). Sem isso o export sai com SKU interno e o fiscal mapeia na mão.

## Comprovante térmico
Configurável no `.env`:
- `RECEIPT_MODE=browser` (padrão): "Imprimir comprovante" abre um recibo 80mm e usa a impressão do
  tablet (AirPrint/impressora compartilhada).
- `RECEIPT_MODE=network`: o servidor envia ESC/POS direto para uma impressora térmica de rede.
  Defina `PRINTER_HOST` (IP da impressora) e `PRINTER_PORT` (9100). Mais confiável com várias mesas.

## Backup (à prova de susto)
- O servidor faz **backup automático** do banco a cada `BACKUP_INTERVAL_MIN` minutos em
  `data/backups/`. O banco é um único arquivo (`data/loja.db`).
- Backup manual: `npm run backup`.
- **Recomendado:** copie `data/backups/` para um pendrive de tempos em tempos. Tenha um 2º notebook
  com o projeto já instalado como reserva.

## Checklist do dia
1. [ ] Notebook carregado / na tomada + nobreak ou powerbank.
2. [ ] Roteador ligado, IP do notebook fixado.
3. [ ] `npm start` rodando; testar 1 venda de ponta a ponta.
4. [ ] Conferir preços e estoques no Admin.
5. [ ] Tablets conectados na rede e na URL certa; testar em cada um.
6. [ ] Maquininha(s) carregada(s); promotores sabem digitar o NSU.
7. [ ] Pendrive de backup à mão.

## Estrutura
```
server.js            API + criação de pedido transacional + backup automático
src/db.js            SQLite (WAL) + schema + auditoria
src/seed.js          carrega data/catalogo.csv → produtos
src/print.js         recibo 80mm (HTML) + ESC/POS de rede
src/export.js        export Sankhya (NF) e clientes (CRM)
public/              PDV (index), Admin, CSS (tokens TRUE), JS, PWA (manifest + sw)
data/catalogo.csv    catálogo (você preenche preço/estoque)
data/loja.db         banco SQLite (gerado; não versionar)
scripts/backup.js    backup manual
```
