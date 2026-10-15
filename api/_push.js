// Notificações: chaves VAPID, aparelhos inscritos e envio.
// Os aparelhos ficam num arquivo separado no Blob (caixa/push.json), fora dos dados do app.
import crypto from 'node:crypto';
import webpush from 'web-push';
import { chave, lerEstado, alterar } from './_lib.js';

export const ARQUIVO_PUSH = 'caixa/push.json';

/* As chaves saem do segredo do app, então não precisam de configuração.
   Se VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY existirem, valem elas. */
export function vapid() {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  }
  let semente = crypto.createHash('sha256').update('caixa-vapid:' + chave()).digest();
  for (let i = 0; i < 8; i++) {
    try {
      const ecdh = crypto.createECDH('prime256v1');
      ecdh.setPrivateKey(semente);
      return { publicKey: ecdh.getPublicKey().toString('base64url'), privateKey: semente.toString('base64url') };
    } catch {
      semente = crypto.createHash('sha256').update(semente).digest();
    }
  }
  throw new Error('não consegui gerar as chaves de notificação');
}

const idDe = (endpoint) => crypto.createHash('sha256').update(String(endpoint)).digest('base64url').slice(0, 32);

export function validarInscricao(sub) {
  const ok = sub && typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) && sub.endpoint.length < 1000 &&
    sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string' && sub.keys.p256dh.length < 200 && sub.keys.auth.length < 100;
  return ok ? { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } } : null;
}

export async function lerPush() {
  const { estado } = await lerEstado(ARQUIVO_PUSH);
  return { subs: estado.subs || {}, enviados: estado.enviados || {} };
}

export async function inscrever(sub, aparelho) {
  // já inscrito com as mesmas chaves: não grava de novo
  const { subs } = await lerPush();
  const atual = subs[idDe(sub.endpoint)];
  if (atual && atual.keys && atual.keys.p256dh === sub.keys.p256dh && atual.keys.auth === sub.keys.auth) return;
  await alterar((e) => {
    e.subs = e.subs || {};
    const id = idDe(sub.endpoint);
    e.subs[id] = Object.assign({}, e.subs[id], sub, { aparelho: String(aparelho || '').slice(0, 120), vistoEm: new Date().toISOString() });
    if (!e.subs[id].criadoEm) e.subs[id].criadoEm = e.subs[id].vistoEm;
  }, ARQUIVO_PUSH);
}

export async function desinscrever(endpoint) {
  await alterar((e) => { if (e.subs) delete e.subs[idDe(endpoint)]; }, ARQUIVO_PUSH);
}

/* Envia para todos os aparelhos. Os que o celular já cancelou (404/410) saem da lista. */
export async function enviarTodos(aviso) {
  const { publicKey, privateKey } = vapid();
  const { subs } = await lerPush();
  const ids = Object.keys(subs);
  const mortos = [];
  let enviados = 0;
  await Promise.all(ids.map(async (id) => {
    try {
      await webpush.sendNotification({ endpoint: subs[id].endpoint, keys: subs[id].keys }, JSON.stringify(aviso), {
        vapidDetails: { subject: 'https://caixa-do-leandro-lovat.vercel.app', publicKey, privateKey },
        TTL: 12 * 60 * 60,
        urgency: 'normal',
      });
      enviados++;
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) mortos.push(id);
      else console.error('push', e && e.statusCode, e && e.body);
    }
  }));
  if (mortos.length) await alterar((e) => { mortos.forEach((id) => { if (e.subs) delete e.subs[id]; }); }, ARQUIVO_PUSH);
  return { aparelhos: ids.length, enviados, removidos: mortos.length };
}

export async function marcarEnviado(chaveAviso) {
  await alterar((e) => {
    e.enviados = e.enviados || {};
    e.enviados[chaveAviso] = new Date().toISOString();
    // guarda só os últimos 60
    const ks = Object.keys(e.enviados).sort();
    ks.slice(0, Math.max(0, ks.length - 60)).forEach((k) => delete e.enviados[k]);
  }, ARQUIVO_PUSH);
}
