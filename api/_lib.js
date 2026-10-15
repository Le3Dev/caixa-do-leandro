// Coisas usadas por todas as funções: login, leitura e gravação dos dados.
// Os dados ficam num único arquivo JSON privado no Vercel Blob.
import { get, head, put, BlobPreconditionFailedError, BlobNotFoundError } from '@vercel/blob';
import crypto from 'node:crypto';

const ARQUIVO = 'caixa/estado.json';
const COOKIE = 'caixa_sess';
const UM_ANO = 365 * 24 * 60 * 60;

export class ErroPedido extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function falha(e) {
  if (e instanceof ErroPedido) return json({ erro: e.message }, e.status);
  console.error(e);
  return json({ erro: 'Erro no servidor' }, 500);
}

/* ---------- sessão ---------- */
// A chave que assina o login vem de APP_SECRET; sem ela, sai da senha junto com o token do Blob,
// que também é secreto. Trocar a senha desconecta todos os aparelhos.
function chave() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (!process.env.APP_PASSWORD) throw new Error('APP_PASSWORD não configurada');
  return crypto.createHash('sha256').update('caixa:' + process.env.APP_PASSWORD + ':' + (process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID || '')).digest('hex');
}
function assinar(valor) {
  return crypto.createHmac('sha256', chave()).update(valor).digest('base64url');
}
function iguais(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function senhaConfere(senha) {
  const certa = process.env.APP_PASSWORD;
  if (!certa || typeof senha !== 'string') return false;
  // compara os hashes para o tempo não depender do tamanho da senha
  const h = (s) => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(senha), h(certa));
}
export function cookieDeSessao() {
  const exp = Date.now() + UM_ANO * 1000;
  const valor = 'v1.' + exp;
  const token = valor + '.' + assinar(valor);
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${UM_ANO}`;
}
export function cookieDeSaida() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}
export function autorizado(request) {
  const cookies = request.headers.get('cookie') || '';
  const m = cookies.match(/(?:^|;\s*)caixa_sess=([^;]+)/);
  if (!m) return false;
  const partes = m[1].split('.');
  if (partes.length !== 3) return false;
  const [versao, exp, sig] = partes;
  try {
    if (!iguais(sig, assinar(versao + '.' + exp))) return false;
  } catch {
    return false;
  }
  return Number(exp) > Date.now();
}
export function exigirLogin(request) {
  if (!autorizado(request)) throw new ErroPedido('login', 401);
}

/* ---------- dados ---------- */
// A versão (etag) vem do head(), que é a mesma que o put() confere; a que vem no download do get()
// pode chegar em outro formato e fazer toda gravação parecer conflito.
// Lê a versão antes do conteúdo: se alguém gravar no meio, o put() falha e tenta de novo.
export async function lerEstado() {
  let meta;
  try {
    meta = await head(ARQUIVO);
  } catch (e) {
    if (e instanceof BlobNotFoundError) return { estado: { cols: {} }, etag: null, salvo: false };
    throw e;
  }
  const r = await get(ARQUIVO, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) throw new Error('não consegui baixar os dados (' + (r ? r.statusCode : 404) + ')');
  const texto = await new Response(r.stream).text();
  return { estado: JSON.parse(texto), etag: meta.etag, salvo: true };
}

async function salvarEstado(estado, etag) {
  const corpo = JSON.stringify(estado);
  if (corpo.length > 4_000_000) throw new ErroPedido('Os dados passaram do limite do app.', 413);
  const opcoes = { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 };
  if (etag) opcoes.ifMatch = etag;
  await put(ARQUIVO, corpo, opcoes);
}

/* Lê, muda e grava. Se outra gravação entrou no meio, tenta de novo com os dados novos. */
export async function alterar(mudar) {
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    const { estado, etag } = await lerEstado();
    estado.cols = estado.cols || {};
    mudar(estado);
    estado.atualizadoEm = new Date().toISOString();
    try {
      await salvarEstado(estado, etag);
      return estado;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError && tentativa < 3) continue;
      throw e;
    }
  }
  throw new Error('não consegui salvar');
}

const NOME_OK = /^[A-Za-z0-9_.\-:@+~]{1,200}$/;
function mesclar(alvo, novo) {
  const saida = Object.assign({}, alvo);
  for (const [k, v] of Object.entries(novo || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && saida[k] && typeof saida[k] === 'object' && !Array.isArray(saida[k])) {
      saida[k] = mesclar(saida[k], v);
    } else {
      saida[k] = v;
    }
  }
  return saida;
}
/* Confere um backup antes de trocar todos os dados por ele. */
export function validarBackup(b) {
  const cols = b && (b.cols || b);
  if (!cols || typeof cols !== 'object' || Array.isArray(cols)) throw new ErroPedido('Arquivo de backup inválido.');
  for (const [nome, docs] of Object.entries(cols)) {
    if (!NOME_OK.test(nome) || !docs || typeof docs !== 'object' || Array.isArray(docs)) throw new ErroPedido('Arquivo de backup inválido.');
    for (const [id, d] of Object.entries(docs)) {
      if (!NOME_OK.test(id) || !d || typeof d !== 'object' || Array.isArray(d)) throw new ErroPedido('Arquivo de backup inválido.');
    }
  }
  if (!cols.config || !cols.config.main) throw new ErroPedido('Esse arquivo não parece um backup do Caixa.');
  return cols;
}

export function aplicarOps(estado, ops) {
  if (!Array.isArray(ops) || !ops.length || ops.length > 100) throw new ErroPedido('Nada para salvar.');
  for (const o of ops) {
    if (!o || !NOME_OK.test(String(o.col)) || !NOME_OK.test(String(o.id))) throw new ErroPedido('Caminho inválido.');
    const col = estado.cols[o.col] = estado.cols[o.col] || {};
    if (o.op === 'delete') {
      delete col[o.id];
    } else if (o.op === 'set') {
      if (!o.data || typeof o.data !== 'object' || Array.isArray(o.data)) throw new ErroPedido('Documento inválido.');
      col[o.id] = o.data;
    } else if (o.op === 'update') {
      if (!col[o.id]) throw new ErroPedido('Esse item não existe mais.', 409);
      col[o.id] = mesclar(col[o.id], o.data);
    } else {
      throw new ErroPedido('Operação inválida.');
    }
  }
}
