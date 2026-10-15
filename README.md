# Caixa do Leandro

App pessoal para lançar o salário, separar o que fica comigo e o que vai para investir,
controlar revendas e acompanhar o patrimônio todo dia.

## Como funciona

- `public/index.html` — o app inteiro (uma página).
- `api/` — funções da Vercel:
  - `login` — entra com a senha (`APP_PASSWORD`) e guarda a sessão por um ano;
  - `estado` / `escrever` — leem e gravam os dados num arquivo JSON privado do Vercel Blob;
  - `importar` — restaura um backup;
  - `mercado` — busca dólar PTAX, CDI, Selic e IPCA no Banco Central. Roda sozinho todo dia útil às 18h (cron em `vercel.json`) e também quando o app abre com os dados velhos.

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
