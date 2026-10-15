import { json, falha, exigirLogin, alterar, aplicarOps, ErroPedido } from './_lib.js';

// POST /api/escrever  { ops: [{ op: 'set' | 'update' | 'delete', col, id, data }] }
export async function POST(request) {
  try {
    exigirLogin(request);
    let corpo;
    try {
      corpo = await request.json();
    } catch {
      throw new ErroPedido('Pedido inválido.');
    }
    const estado = await alterar((e) => aplicarOps(e, corpo && corpo.ops));
    return json({ cols: estado.cols, atualizadoEm: estado.atualizadoEm });
  } catch (e) {
    return falha(e);
  }
}
