# Recebimentos Habitar

Sistema web para controlar os recebimentos a prazo dos clientes da Habitar Imóveis: entradas pagas em data futura e entradas parceladas. Usado pela Ana Laura e pela Adriana, inclusive pelo celular.

- **Banco de dados:** planilha Google `Controle_Recebimentos_Habitar` (abas `db_*`). Ninguém edita a planilha direto.
- **API:** Google Apps Script vinculado à planilha, publicado como App da Web (`apps-script/`).
- **Site:** HTML, CSS e JavaScript puro, sem build, publicado no GitHub Pages (raiz deste repositório).

Este repositório é público e **não contém nenhum dado de cliente, senha ou token**. Tudo fica só na planilha e no Apps Script.

## Como funciona

| Camada | Onde fica | O que faz |
|---|---|---|
| `db_vendas` | planilha | uma linha por venda (cliente, imóvel, entrada, nº de parcelas…) |
| `db_parcelas` | planilha | uma linha por parcela (valor, vencimento, status, pagamento) |
| `db_usuarios` | planilha | logins com senha em hash (salt + SHA-256) |
| `db_log` | planilha | quem fez o quê e quando |
| `apps-script/*.gs` | Apps Script | login com token (12 h), cálculos, validação, LockService |
| `index.html`, `js/`, `css/` | GitHub Pages | Painel, Vendas, Parcelas, Histórico, temas claro/escuro |

Regras de cálculo (sempre no backend, nunca por fórmula):

- **Situação da parcela:** `Pago`; senão `Atrasado` (vencimento passou), `Vence em até 7 dias` ou `A vencer`.
- **Por venda:** total recebido = soma do `valor_pago` das parcelas pagas; **saldo = soma das parcelas em aberto** (assim juros ou descontos lançados no valor pago não distorcem o que falta); situação `Quitada` / `Em atraso` / `Em dia`; aviso **"Parcelas não batem com o valor da entrada"** quando a soma das parcelas difere da entrada.
- **Geração de parcelas:** valor dividido igualmente, diferença de centavos na última. Mensal, quinzenal ou datas personalizadas. A prévia é editável antes de salvar.
- **Edição de venda com parcelas pagas:** as pagas nunca mudam; só as em aberto são recalculadas, com confirmação.
- Datas gravadas como texto `yyyy-mm-dd` no fuso `America/Sao_Paulo`; valores como número.

## Publicação: passo a passo

### 1. Apps Script

1. Abra a planilha `Controle_Recebimentos_Habitar` e vá em **Extensões → Apps Script**.
2. No editor, crie um arquivo para cada `.gs` da pasta `apps-script/` com o mesmo nome (`Code`, `Auth`, `Db`, `Parcelas`, `Vendas`, `Setup`) e cole o conteúdo. Apague o `Code.gs` vazio padrão antes de colar o novo.
3. Em **Configurações do projeto** (engrenagem), marque **Mostrar o arquivo de manifesto "appsscript.json"** e cole o conteúdo de `apps-script/appsscript.json`. Isso define o fuso `America/Sao_Paulo` e o acesso do App da Web.
4. Salve tudo (Ctrl+S).

### 2. Criar o banco (uma única vez)

1. No editor, escolha a função **`setupDatabase`** na barra superior e clique em **Executar**. Autorize o acesso quando o Google pedir.
2. Confira na planilha: abas `db_vendas`, `db_parcelas`, `db_usuarios` e `db_log` com cabeçalho na linha 1; as abas antigas viraram `backup_Vendas`, `backup_Parcelas` e `backup_Resumo` (nada foi apagado).
3. As três linhas de exemplo (Cliente Exemplo 1 a 3) foram migradas de propósito, para servirem de teste. Quando quiser, exclua-as pelo próprio sistema (botão ✕ na tela Vendas). Para não migrá-las, mude `MIGRAR_EXEMPLOS` para `false` em `Setup.gs` antes de rodar.

Se precisar recomeçar do zero: apague as abas `db_*`, renomeie as `backup_*` de volta e rode `setupDatabase` de novo.

### 3. Cadastrar os usuários

Recarregue a planilha (F5). Aparece o menu **Recebimentos Habitar** ao lado de "Ajuda".

1. Clique em **Recebimentos Habitar → Criar ou redefinir usuário**.
2. Informe o login (ex.: `ana`), o nome que aparece no sistema (ex.: `Ana Laura`) e uma senha com pelo menos 6 caracteres.
3. Repita para a Adriana (ex.: login `adriana`).

A senha é digitada numa caixa de diálogo e gravada só como hash. Para trocar uma senha, use o mesmo menu com o mesmo login. Para tirar o acesso de alguém: **Desativar usuário**. Alternativa pelo editor: criar uma função temporária que chame `criarUsuario('ana', 'Ana Laura', 'senha')`, executar e **apagar a função em seguida**, para a senha não ficar no código.

### 4. Publicar o App da Web

1. No Apps Script, clique em **Implantar → Nova implantação**.
2. Na engrenagem ao lado de "Selecione o tipo", escolha **App da Web**.
3. Preencha: **Descrição** `Recebimentos Habitar` · **Executar como:** Eu · **Quem pode acessar:** Qualquer pessoa.
4. Clique em **Implantar** e autorize, se pedir.
5. Copie a **URL do app da Web** (termina em `/exec`). Para testar, abra-a no navegador: deve aparecer `{"ok":true,...}`.

"Qualquer pessoa" significa apenas que o site consegue chamar a API; cada chamada continua exigindo login e token.

### 5. Ligar o site à API

Em `js/config.js`, cole a URL entre as aspas:

```js
window.API_URL = 'https://script.google.com/macros/s/.../exec';
```

Faça o commit e o push. O GitHub Pages atualiza em cerca de um minuto.

### 6. GitHub Pages

O site está em **https://anavrodovalho.github.io/recebimentos-habitar/** (repositório `anavrodovalho/recebimentos-habitar`, branch `main`, pasta raiz). Se precisar reativar: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.

### 7. Colocar no celular

- **iPhone:** abra o site no Safari, toque em **Compartilhar → Adicionar à Tela de Início**.
- **Android:** abra no Chrome, menu de três pontos → **Adicionar à tela inicial**.

## Atualizar o Apps Script depois

Mudou um `.gs`? Salvar não basta: o site continua na versão antiga até você publicar uma nova versão **da mesma implantação**.

1. Cole o código novo e salve.
2. **Implantar → Gerenciar implantações**.
3. Clique no lápis (**Editar**), em **Versão** escolha **Nova versão** e clique em **Implantar**.

A URL continua a mesma. **Não use "Nova implantação"**, porque ela cria outra URL e o `config.js` deixaria de funcionar.

## Testes locais

Não é preciso o Apps Script para testar o código:

```bash
node tests/testes-backend.js          # regras de negócio e API num simulador do Apps Script (25 testes)
AGORA="2026-11-13T15:00:00-03:00" node tests/servidor-dev.js   # site em http://localhost:8787 (ana / adriana, senha teste123)
```

O servidor de testes serve o site e responde `/api` com o backend simulado em memória. A variável `AGORA` fixa a data de "hoje", útil para ver parcelas atrasadas.

## Estrutura

```
apps-script/   Code.gs (roteamento e utilitários) · Auth.gs · Db.gs · Parcelas.gs · Vendas.gs · Setup.gs · appsscript.json
index.html     login + aplicação (menu lateral; no celular vira menu inferior)
css/styles.css temas claro/escuro por variáveis CSS
js/            config.js · utils.js · api.js · theme.js · app.js · dashboard.js · vendas.js · parcelas.js · historico.js
assets/        logo-habitar.png (branca, fundo transparente), ícones
tests/         simulador.js · testes-backend.js · servidor-dev.js
```

## API (resumo)

Um único `doPost` com `{ action, token, payload }`, corpo enviado como `text/plain` (evita o preflight de CORS). Resposta sempre `{ ok, data, error, code }`.

| Ação | Payload | Observação |
|---|---|---|
| `login` | `{usuario, senha}` | única ação sem token; 5 erros bloqueiam por 15 min |
| `logout` | — | invalida o token |
| `getDashboard` | — | cards, previsão de 12 meses, "Atenção hoje" |
| `listVendas` / `getVenda` | — / `{id}` | vendas com campos calculados |
| `saveVenda` | venda + `parcelas[]` (+ `confirmarRecalculo`) | cria ou edita; devolve `code: CONFIRMAR` quando há parcelas pagas |
| `deleteVenda` | `{id}` | exclusão lógica da venda e das parcelas |
| `listParcelas` | — | todas as parcelas com cliente, imóvel e situação |
| `saveParcela` | parcela | cria avulsa ou edita |
| `baixarParcela` | `{id, data_pagamento, valor_pago, forma_pagamento}` | |
| `estornarParcela` / `deleteParcela` | `{id}` | paga não pode ser excluída: estorne antes |
| `listLog` | `{limite}` | histórico, mais recente primeiro |

Toda ação de escrita roda dentro do `LockService`, então duas pessoas podem salvar ao mesmo tempo sem corromper a planilha.
