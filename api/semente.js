import crypto from 'node:crypto';
import { json, falha, lerEstado, alterar, validarBackup, ErroPedido } from './_lib.js';
import { CIFRA } from './_semente.js';

// GET /api/semente?chave=... → preenche o Blob com os dados de 15/10, só se ele ainda estiver vazio.
// Uso único durante a mudança para a Vercel; nunca sobrescreve dados salvos.
export async function GET(request) {
  try {
    const chave = new URL(request.url).searchParams.get('chave') || '';
    if (!/^[0-9a-f]{64}$/.test(chave)) throw new ErroPedido('chave inválida', 401);
    const { salvo } = await lerEstado();
    if (salvo) return json({ ok: false, motivo: 'já existem dados salvos; nada foi alterado' }, 409);
    let texto;
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(chave, 'hex'), Buffer.from(CIFRA.iv, 'base64'));
      d.setAuthTag(Buffer.from(CIFRA.tag, 'base64'));
      texto = Buffer.concat([d.update(Buffer.from(CIFRA.dados, 'base64')), d.final()]).toString('utf8');
    } catch {
      throw new ErroPedido('chave errada', 401);
    }
    const cols = validarBackup(JSON.parse(texto));
    const estado = await alterar((e) => { e.cols = cols; });
    const resumo = Object.fromEntries(Object.entries(estado.cols).map(([k, v]) => [k, Object.keys(v).length]));
    return json({ ok: true, resumo });
  } catch (e) {
    return falha(e);
  }
}
