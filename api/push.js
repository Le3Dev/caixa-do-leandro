import { json, falha, exigirLogin, ErroPedido } from './_lib.js';
import { vapid, validarInscricao, inscrever, desinscrever, enviarTodos } from './_push.js';

// GET  /api/push → chave pública para o celular se inscrever
// POST /api/push { acao: 'assinar', sub } | { acao: 'sair', endpoint } | { acao: 'teste' }
export async function GET(request) {
  try {
    exigirLogin(request);
    return json({ chave: vapid().publicKey });
  } catch (e) {
    return falha(e);
  }
}

export async function POST(request) {
  try {
    exigirLogin(request);
    let corpo;
    try { corpo = await request.json(); } catch { throw new ErroPedido('Pedido inválido.'); }
    if (corpo.acao === 'assinar') {
      const sub = validarInscricao(corpo.sub);
      if (!sub) throw new ErroPedido('Inscrição inválida.');
      await inscrever(sub, request.headers.get('user-agent'));
      return json({ ok: true });
    }
    if (corpo.acao === 'sair') {
      if (typeof corpo.endpoint !== 'string') throw new ErroPedido('Pedido inválido.');
      await desinscrever(corpo.endpoint);
      return json({ ok: true });
    }
    if (corpo.acao === 'teste') {
      const r = await enviarTodos({ title: 'Caixa', body: 'Notificações ligadas. Você vai receber um aviso nos dias de pagamento.', url: '/?aba=mes', tag: 'teste' });
      return json(r);
    }
    throw new ErroPedido('Ação inválida.');
  } catch (e) {
    return falha(e);
  }
}
