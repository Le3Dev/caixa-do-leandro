import { json, falha, exigirLogin, alterar, validarBackup, ErroPedido } from './_lib.js';

// POST /api/importar  { cols } → troca todos os dados pelos do backup (precisa estar logado)
export async function POST(request) {
  try {
    exigirLogin(request);
    let corpo;
    try {
      corpo = await request.json();
    } catch {
      throw new ErroPedido('Arquivo de backup inválido.');
    }
    const cols = validarBackup(corpo);
    const estado = await alterar((e) => { e.cols = cols; });
    return json({ cols: estado.cols, atualizadoEm: estado.atualizadoEm });
  } catch (e) {
    return falha(e);
  }
}
