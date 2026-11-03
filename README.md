# Caixa do Leandro

App pessoal para lançar o salário, separar o que fica comigo e o que vai para investir,
controlar revendas e acompanhar o patrimônio todo dia.

## Como funciona

- `public/index.html` — o app inteiro (uma página).
- `api/` — funções da Vercel:
  - `login` — entra com a senha (`APP_PASSWORD`) e guarda a sessão por um ano;
  - `estado` / `escrever` — leem e gravam os dados num arquivo JSON privado do Vercel Blob;
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
