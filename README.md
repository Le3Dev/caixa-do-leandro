# Caixa do Leandro

App pessoal para lançar o salário, separar o que fica comigo e o que vai para investir,
controlar revendas e acompanhar o patrimônio todo dia.

## Como funciona

- `public/index.html` — o app inteiro (uma página).
- `public/relatorio.js` — os relatórios em PDF (semana/mês e "Meus gastos"), desenhados no aparelho com o jsPDF.
- `public/extrato.js` — leitura do extrato do Itaú em PDF, no próprio aparelho. Veja [Controle de gastos](#controle-de-gastos-para-mim).
- `api/` — funções da Vercel:
  - `login` — entra com a senha (`APP_PASSWORD`) e guarda a sessão por um ano;
  - `estado` / `escrever` — leem e gravam os dados num arquivo JSON privado do Vercel Blob. Ao gravar um gasto, `escrever` também confere o aviso de 80%/100% do mês (`api/_alertasGastos.js`);
  - `importar` — restaura um backup;
  - `mercado` — busca dólar PTAX, CDI, Selic e IPCA no Banco Central e guarda o fechamento diário dos índices de mercado. Roda sozinho todo dia útil às 18h (cron em `vercel.json`) e também quando o app abre com os dados velhos;
  - `indices` — cotação dos índices de mercado na hora (gráficos, resumo do dia e destaques da semana). Veja [Índices de mercado](#índices-de-mercado).

Nenhum dado pessoal fica neste repositório: tudo mora no Blob privado da conta Vercel.

## Configuração na Vercel

1. Importar este repositório como projeto (Framework: Other).
2. Variável de ambiente `APP_PASSWORD` com a senha do app.
3. Storage → Blob → criar um store **privado** e conectar ao projeto.
4. Fazer um novo deploy para as variáveis valerem.

Opcionais: `APP_SECRET` (chave da sessão; sem ela, é derivada da senha) e `CRON_SECRET`
(protege a chamada do cron).

Para conferir a configuração: `https://SEU-DOMINIO/api/estado?diag=1`.

### Verificação de domínio

Os arquivos `public/bastion-verificacao.txt` e `public/.well-known/bastion-verificacao.txt` comprovam a posse
do domínio `caixa-do-leandro-lovat.vercel.app` pelo método de arquivo (não é possível criar registros DNS TXT em
subdomínios `*.vercel.app`). Não devem ser removidos.

## Cópias automáticas
Todo dia útil, junto com a atualização do dólar e do CDI, o app grava uma cópia dos dados em
`caixa/backups/AAAA-MM.json` no Blob (uma por mês, com o último estado do mês). Para restaurar,
baixe o arquivo no painel da Vercel (Storage → Blob) e use Ajustes → Importar backup.

## Índices de mercado

Na aba Mês, o card de índices mostra o gráfico de cada índice, a variação do dia e a do período.

| Índice | O que mede |
|---|---|
| **Ibovespa** | Principal índice da B3: as ações mais negociadas da bolsa brasileira, com peso pelo valor de mercado. A carteira é revista a cada 4 meses. |
| **IFIX** | Os fundos imobiliários (FIIs) mais negociados da B3. |
| **S&P 500** | As 500 maiores empresas dos EUA, com peso pelo valor de mercado. |
| **Nasdaq** (Composite) | Todas as ações listadas na Nasdaq, com forte peso de tecnologia. |
| **Dow Jones** | 30 grandes empresas americanas, com peso pelo preço da ação (não pelo tamanho da empresa). |
| **Nikkei 225** | As 225 principais empresas da Bolsa de Tóquio, com peso pelo preço da ação. |

**Períodos:** `1D` (pregão atual, pontos a cada 5 min), `5D` (5 pregões, a cada 15 min), `1M`, `6M`,
`YTD` (desde 1º de janeiro), `1A`, `5A` (um ponto por semana) e `MAX` (um ponto por mês). As datas são
sempre a data local da bolsa (Tóquio está 12h à frente de Brasília).

**Atualização ao vivo:** os gráficos são buscados na hora, quando o card abre ou o período muda. O servidor
guarda cada resposta por 60 s (1D, 5D e resumo), 5 min (1M) ou 15 min (demais períodos). Durante o
pregão o app atualiza sozinho a cada 60 s. Se a busca ao vivo falhar, o app usa os fechamentos diários que
o cron grava em `mercado_hist` e mostra o aviso de `mercado.atual.indicesErro`. Com o pregão aberto,
o cron não grava a barra do dia (ainda não é fechamento); ela entra na passada seguinte.

**Destaques da semana:** as ações do Ibovespa que mais caíram e mais subiram na semana (até 10 de cada).
A semana vai da segunda até a última cotação e é comparada com o fechamento do pregão anterior à
segunda (normalmente a sexta). No sábado e no domingo aparece a semana que acabou. Na segunda antes da
abertura (sem cotação na semana) aparece a semana anterior, fechada (`fechada: true`).

### Endpoints de índices

Todos exigem login (cookie da sessão). Sem login: `401 { "erro": "login" }`. Respostas com
`cache-control: private, max-age=30`.

**`GET /api/indices?id=<id>&periodo=<periodo>`**: gráfico de um índice.

- `id`: `ibovespa` | `ifix` | `sp500` | `nasdaq` | `dowjones` | `nikkei`
- `periodo`: `1D` | `5D` | `1M` | `6M` | `YTD` | `1A` | `5A` | `MAX`

```json
{
  "id": "ibovespa", "nome": "Ibovespa", "moeda": "BRL", "periodo": "1D",
  "valor": 165405.4, "horario": "2026-11-03T15:50:30.000Z", "pregaoAberto": true,
  "fechamentoAnterior": 167921.8, "intradiario": true,
  "pontos": [{ "t": 1793710800000, "data": "2026-11-03", "valor": 167917.3 }],
  "resumo": { "abertura": 167917.3, "alta": 168005.45, "baixa": 164446.53, "alta52": 209714, "baixa52": 149979 },
  "fonte": "Yahoo Finance"
}
```

- `moeda`: `BRL` | `USD` | `JPY` | `null`. `horario`: ISO (UTC) da última cotação.
- `pontos`: ordenados por `t` (epoch em ms). `data` é a data local da bolsa. `intradiario` é `true` em 1D e 5D (pontos com hora).
- `resumo` e `fechamentoAnterior` são sempre da sessão atual (ou da última, com a bolsa fechada). Os campos podem vir `null`.
- `fonte`: `Yahoo Finance` ou `CNBC`.
- Erros: `400 { "erro": "..." }` para id ou período inválido; `502 { "erro": "Não consegui buscar o <nome> agora. Tente de novo em alguns minutos." }` quando todas as fontes falharam.

**`GET /api/indices?lista=resumo`**: último valor e variação do dia de todos os índices.

```json
{
  "atualizadoEm": "2026-11-03T16:06:01.412Z",
  "indices": [{ "id": "sp500", "nome": "S&P 500", "moeda": "USD", "valor": 7584.87,
                "variacaoDia": 43.47, "variacaoDiaPct": 0.5764,
                "horario": "2026-11-03T16:06:00.000Z", "pregaoAberto": true }],
  "falhas": { "nikkei": "Não consegui buscar o Nikkei 225 agora. Tente de novo em alguns minutos." },
  "fonte": "Yahoo Finance"
}
```

`variacaoDia` = valor − fechamento anterior; `variacaoDiaPct` em %. O índice que falhou sai de
`indices` e aparece em `falhas`.

**`GET /api/indices?lista=destaques-semana`**: maiores quedas e altas da semana entre as ações do Ibovespa.

```json
{
  "semana": { "de": "2026-11-02", "ate": "2026-11-03", "base": "2026-10-30" },
  "fechada": false, "atualizadoEm": "...",
  "quedas": [{ "codigo": "XXXX3", "nome": "...", "preco": 10.5, "variacaoSemana": -1.2,
               "variacaoSemanaPct": -10.26, "participacao": 1.8 }],
  "altas": [], "total": 84, "semDados": ["YYYY3"], "fonte": "..."
}
```

`semana.base` é o pregão usado como referência (fechamento anterior à segunda). Há até 10 ações em
`quedas` e 10 em `altas`. `total` é quantas ações entraram na conta, e `semDados` lista as que ficaram sem cotação.
Se não der para montar a lista, a resposta é `502 { "erro": "Não consegui montar os destaques da semana agora. Tente de novo em alguns minutos." }`.

**Campos gravados por `/api/mercado` em `mercado.atual`:** `indices` (último valor e variação do dia de
cada índice, para o app usar sem a API ao vivo), `indicesAtualizadoEm` (ISO da última busca que deu certo)
e `indicesErro` (mensagem da última falha, ou `null` quando todos vieram). O retorno de `/api/mercado`
traz também `falhasIndices: { <id>: mensagem }`.

## Controle de gastos (Para mim)

Na aba Para mim, os gastos do mês são comparados com o valor que fica com você no mês (Ajustes,
`config.main.paraMim`), chamado aqui de **meta**. O mês é o mês da data do gasto, no
horário de Brasília. Gastos fixos e gastos importados do extrato contam como qualquer outro gasto.

### Aviso de 80% e de 100%

- **No app:** o card de gastos do mês avisa quando os gastos chegam a 80% da meta e quando passam dela
  (só quando o card está no mês atual).
- **No celular:** quando um gasto é gravado (`/api/escrever`), o servidor recalcula o mês atual. Se chegou a
  80% ou passou de 100%, manda uma notificação para os aparelhos inscritos. Tocar nela abre a aba Para mim
  (`/?aba=mim`).
  - 80%: *"Para mim: 80% usado. Você já gastou R$ 880,00 dos R$ 1.100,00 de novembro. Sobram R$ 220,00 para 27 dias."*
  - 100%: *"Para mim: limite passou. Você gastou R$ 1.130,00 em novembro, R$ 30,00 acima dos R$ 1.100,00."*
- 80% vale a partir de 80% da meta, e 100% quando os gastos passam da meta (chegar exatamente à meta ainda é 80%).
- Cada faixa sai **uma vez por mês**. Fica marcada em `enviados` de `caixa/push.json` com a chave
  `gastos:AAAA-MM:80` ou `gastos:AAAA-MM:100`. Apagar um gasto e lançar de novo não repete o aviso.
- Se os gastos pularem de menos de 80% direto para mais de 100%, sai só o aviso de 100% (o de 80% fica marcado também).
- Só vale para o mês atual: gasto lançado num mês passado não dispara aviso. Sem meta (0), não há aviso.
- Se nenhum aparelho estiver inscrito ou o envio não chegar a nenhum, o aviso não é marcado e é tentado de novo
  na próxima gravação de gasto. Um erro na notificação vai só para o log: a gravação vale do mesmo jeito.

### Ver gastos de outros meses

- O card **Gastos de <mês>** abre no mês atual. Os botões **‹ ›** do topo trocam o mês: não dá para voltar antes
  do mês do primeiro gasto nem passar do mês atual (o botão fica desligado). Mês sem gasto mostra
  "Nenhum gasto em <mês>.". O card só some quando não há nenhum gasto lançado.
- Em qualquer mês aparecem o total contra a meta, a comparação com o mês anterior inteiro e as barras por categoria.
  O aviso de 80%/100% só aparece no mês atual; num mês passado aparece só quanto sobrou ou quanto passou do limite.
- **Gráfico:** barras dos 6 meses que terminam no mês escolhido (fixos, variáveis, acima do limite e a linha do
  limite), com esse mês em destaque. Tocar numa barra abre aquele mês.
- **Lista do mês:** abaixo das categorias, todos os gastos do mês, do mais recente ao mais antigo, com data,
  categoria, descrição, valor e a marca "Gasto fixo" ou "Do extrato". Editar e Excluir funcionam como no extrato
  (inclusive a regra do fixo pulado).
- **Filtro por categoria:** tocar numa categoria mostra só os gastos dela ("Mostrando só <categoria> · limpar");
  tocar de novo ou em "limpar" volta a mostrar tudo. Trocar de mês limpa o filtro.
- No card **Mês a mês**, tocar num mês da tabela "Quanto sobrou" abre esse mês no card de gastos.

### Gastos fixos

- Ficam na coleção `fixos` (descrição, categoria e valor de cada conta que se repete todo mês).
- Cada fixo entra como gasto (`tipo: 'gasto'`, `fixoId`) com data do **dia 1º do mês**, e já desconta da meta desde o começo do mês.
- O id do gasto é sempre `fixo-<id do fixo>-<AAAA-MM>`. Lançar de novo, por outro aparelho ou outra aba, grava
  o mesmo documento, então o fixo não duplica.
- Apagar o gasto do fixo num mês marca aquele mês como **pulado** no fixo: o app não lança de novo naquele mês,
  e os meses seguintes continuam normais.

### Importar extrato do Itaú (PDF)

- O PDF é lido **no próprio aparelho** com o pdf.js (`public/extrato.js`). Ele não é enviado para o servidor nem guardado. Só as linhas que você confirma viram gastos.
- Antes de gravar, aparece a lista de linhas para revisar. Linhas que não são gasto (entradas, transferências
  entre contas suas, pagamento de fatura, aplicações e resgates) vêm ignoradas por padrão. Linhas sem
  categoria conhecida ficam marcadas para revisar.
- **Regras de categoria aprendidas:** quando você escolhe a categoria de uma descrição, o app grava uma regra na
  coleção `regras` e usa essa categoria nas próximas importações.
- **A mesma linha não entra duas vezes:** cada linha gera uma chave fixa (`chaveExtrato`), e o gasto é gravado
  com um id que sai dessa chave. Importar o mesmo extrato de novo, ou um extrato com dias repetidos, não duplica nada.

### Comparação mês a mês e relatório "Meus gastos"

- O mês atual **até hoje** é comparado com o mesmo ponto do mês passado (até o mesmo dia) e com a média dos
  3 meses anteriores, no total e por categoria.
- O gráfico de barras dos 6 meses fica no card de gastos (ver "Ver gastos de outros meses"), e não mais no
  card Mês a mês. O card Mês a mês continua sempre sobre o mês atual, e o relatório em PDF não mudou.
- O relatório em PDF **"Meus gastos"** é gerado no aparelho (`window.caixaRelatorioGastosPDF(d)` em
  `public/relatorio.js`, que devolve um `Blob`) e traz:
  - os destaques;
  - o gráfico dos últimos 6 meses (fixos e variáveis), com a linha da meta e em vermelho os meses acima dela;
  - quanto sobrou em cada mês;
  - a comparação do mês atual;
  - a tabela por categoria (este mês, média de 3 meses e diferença);
  - os 10 maiores gastos do mês.

  Campos sem valor (`null`) aparecem como "—".

Dados que a tela passa para o relatório:

```js
{
  titulo: 'Meus gastos · nov. de 2026', ate: '2026-11-03', meta: 1100,
  meses: [{ mes: '2026-06', nome: 'jun. de 2026', total, fixos, variaveis, sobra /* meta − total */, porCat: [{ id, nome, v }] }], // 6 meses, do mais antigo ao atual
  atual: { mes, nome, total, ateDia, mesmoPontoMesPassado /* ou null */, mediaAnteriores3 /* ou null */ },
  categorias: [{ id, nome, atual, media3, dif }],
  maiores: [{ data, descricao, categoria, valor }],
  destaques: ['texto curto']
}
```

### Dados

| Onde | O que guarda |
|---|---|
| `movimentos` | Gastos, entradas e ajustes: `{ tipo: 'gasto' \| 'entrada' \| 'ajuste', valor (positivo), data 'AAAA-MM-DD', categoria, descricao }`. Campos novos: `fixoId` (gasto lançado por um fixo), `origem: 'extrato'` e `chaveExtrato` (gasto importado do extrato). |
| `fixos` | Os gastos fixos do mês e os meses pulados de cada um. |
| `regras` | As regras de categoria aprendidas na importação do extrato (trecho da descrição → categoria). |
| `caixa/push.json` → `enviados` | As chaves `gastos:AAAA-MM:80` e `gastos:AAAA-MM:100` dos avisos já enviados. |

Categorias: `uber` (Uber e 99), `ifood` (iFood), `restaurante`, `mercado`, `transporte`, `combustivel`
(Combustível), `farmacia` (Farmácia), `compras`, `assinaturas`, `viagem`, `lazer` e `outro`.

## Decisões de arquitetura

**Índices buscados sob demanda, não pelo cron**
- *Contexto:* o plano Hobby da Vercel só deixa o cron rodar 1 vez por dia, e os gráficos ficavam um dia atrasados.
- *Decisão:* a rota `/api/indices` busca na fonte quando o app pede. O cron continua gravando os fechamentos diários em `mercado_hist`.
- *Consequências:* os índices aparecem atualizados durante o pregão. Cada abertura do card pode gerar chamadas externas, o que o cache segura. Sem a fonte ao vivo, o app usa o histórico do cron.

**Yahoo Finance + CNBC como fontes; Stooq removido**
- *Contexto:* o Stooq passou a responder com uma página de verificação em JavaScript. O Yahoo devolve 429 para pedidos sem user-agent de navegador e não tem histórico do IFIX (`IFIX.SA` só traz o intradiário).
- *Decisão:* o Yahoo vem primeiro (com user-agent de navegador e, se falhar, o servidor `query2`), e a CNBC entra como reserva (`.BVSP`, `.IFIX`, `.SPX`, `.IXIC`, `.DJI`, `.N225`). Quando o Yahoo não cobre o período pedido, a CNBC é usada no lugar. Tudo passa pelo módulo `api/_indices.js`, que converte os formatos das duas fontes para o modelo do app.
- *Consequências:* o IFIX usa o Yahoo no intradiário e a CNBC no histórico. As duas fontes não são oficiais e podem mudar sem aviso; o código de cada uma está isolado num só arquivo.

**Composição do Ibovespa pela B3, com cache de 24h**
- *Contexto:* os destaques da semana precisam saber quais ações estão no Ibovespa e o peso de cada uma (`participacao`). A carteira muda só a cada 4 meses.
- *Decisão:* a composição vem da carteira do dia publicada pela B3 e fica 24h em cache.
- *Consequências:* a lista acompanha o rebalanceamento sem manutenção manual, e a B3 é consultada no máximo 1 vez por dia.

**Cache em memória, não na CDN**
- *Contexto:* as rotas exigem login (cookie), então a resposta não pode ficar num cache compartilhado da CDN.
- *Decisão:* cache num `Map` dentro da função (60 s a 15 min, conforme o período) e `cache-control: private` para o navegador. Se a fonte falhar, o servidor devolve o último dado bom com até 6h.
- *Consequências:* o cache dura enquanto a instância da função está quente, e cada instância nova busca de novo. Nada de dados pessoais passa pela CDN.

**Extrato em PDF lido no navegador**
- *Contexto:* o extrato do banco tem dados sensíveis (saldo, nomes, contas). O app guarda tudo num único JSON no Blob e não precisa do arquivo depois da importação. As funções da Vercel também limitam o tamanho do pedido.
- *Decisão:* o PDF é lido no aparelho com o pdf.js (`public/extrato.js`). Para o servidor vão só as linhas confirmadas, já como `movimentos`, pelo `/api/escrever` de sempre.
- *Consequências:* o PDF nunca sai do aparelho e não existe rota nova no servidor. A leitura depende do layout do extrato do Itaú: se o banco mudar o layout, só `public/extrato.js` precisa mudar. Cada pedido ao `/api/escrever` aceita até 100 operações, então importações maiores vão em mais de um pedido.

**Aviso de gastos disparado na gravação, não no cron**
- *Contexto:* no plano Hobby o cron roda 1 vez por dia, e o aviso de 80%/100% faz sentido na hora em que o gasto é lançado.
- *Decisão:* depois de gravar, o `/api/escrever` recalcula o mês atual se o pedido mexeu em `movimentos` (`api/_alertasGastos.js`, só cálculo). Se a faixa mudou, ele envia pelo `api/_push.js` e marca a chave em `enviados`. Tudo fica num `try/catch`: erro na notificação não muda a resposta.
- *Consequências:* o aviso chega na hora, sem cron novo. Abaixo de 80% não há custo extra. Acima, cada gasto gravado lê também `caixa/push.json`. Pedidos que não mexem em gastos (como mudar a meta em Ajustes) e o que não passa pelo `/api/escrever` (importar backup) só disparam o aviso no próximo gasto gravado. Duas gravações no mesmo instante podem mandar o aviso duas vezes, mas a notificação tem a mesma `tag` e o celular mostra uma só.

**Ids determinísticos para gastos fixos e importação**
- *Contexto:* o app pode estar aberto em mais de um aparelho e o mesmo extrato pode ser importado mais de uma vez. As gravações não têm transação entre "ver se já existe" e "criar".
- *Decisão:* o gasto de um fixo usa o id `fixo-<id>-<AAAA-MM>`, e o gasto importado usa um id que sai da chave da linha do extrato (`chaveExtrato`).
- *Consequências:* gravar de novo sobrescreve o mesmo documento em vez de duplicar. Por isso apagar o gasto de um fixo precisa marcar o mês como pulado; sem isso, o app lançaria o gasto de novo.
