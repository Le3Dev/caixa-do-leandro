import { json, falha, exigirLogin, alterar, aplicarOps, ErroPedido } from './_lib.js';
import { lerPush, enviarTodos, marcarEnviado } from './_push.js';
import { situacaoDoMes, avisoPendente, hojeBR } from './_alertasGastos.js';

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
    await avisarGastos(corpo.ops, estado.cols);
    return json({ cols: estado.cols, atualizadoEm: estado.atualizadoEm });
  } catch (e) {
    return falha(e);
  }
}

/* Depois de gravar um gasto: se o mês atual passou de 80% ou de 100% do valor que fica com você,
   manda a notificação (uma vez por mês por faixa). Erro aqui só vai para o log: a gravação já valeu. */
async function avisarGastos(ops, cols) {
  try {
    if (!Array.isArray(ops) || !ops.some((o) => o && o.col === 'movimentos')) return;
    const situacao = situacaoDoMes(cols, hojeBR());
    if (situacao.faixa < 80) return;
    const { subs, enviados } = await lerPush();
    if (!Object.keys(subs).length) return; // nenhum aparelho inscrito: o aviso fica só no app
    const pendente = avisoPendente(situacao, enviados);
    if (!pendente) return;
    const r = await enviarTodos(pendente.aviso);
    // como em /api/avisos: só marca se chegou em algum aparelho, para tentar de novo na próxima gravação
    if (r.enviados > 0) for (const k of pendente.marcar) await marcarEnviado(k);
  } catch (e) {
    console.error('aviso de gastos', e);
  }
}
