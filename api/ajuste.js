import crypto from 'node:crypto';
import { json, falha, alterar, ErroPedido } from './_lib.js';
import { atualizarCotas } from './mercado.js';

// GET /api/ajuste?codigo=<código>&conta=<id>&valor=<R$>&data=AAAA-MM-DD
// Deixa um acerto de saldo pendente. Na próxima vez que o app abrir, ele faz um check-in nessa data
// com esse valor para a conta e com o valor de agora para as outras. Só o hash do código fica aqui.
const HASH = '1ae548855d4e7e02bc35bfceb6c8d2c77dfe146a762216ffbd1961a6ae64e241';

export async function GET(request) {
  try {
    const u = new URL(request.url);
    const codigo = u.searchParams.get('codigo') || '';
    if (crypto.createHash('sha256').update(codigo).digest('hex') !== HASH) return json({ erro: 'não autorizado' }, 401);
    const conta = u.searchParams.get('conta') || '';
    // ?conta=<id>&cnpj=<cnpj> liga a conta à cota diária do fundo na CVM e já busca as cotas
    if (u.searchParams.has('cnpj')) {
      const cnpj = (u.searchParams.get('cnpj') || '').replace(/\D/g, '');
      if (cnpj && cnpj.length !== 14) throw new ErroPedido('CNPJ inválido.');
      let achou = false;
      await alterar((e) => {
        const c = ((e.cols.config && e.cols.config.main && e.cols.config.main.contas) || []).find((x) => x.id === conta);
        if (!c) return;
        achou = true;
        if (cnpj) c.cnpj = cnpj; else delete c.cnpj;
      });
      if (!achou) throw new ErroPedido('Conta não encontrada.', 404);
      return json({ ok: true, conta, cnpj, cotas: await atualizarCotas() });
    }
    const valor = Number(u.searchParams.get('valor'));
    const data = u.searchParams.get('data') || '';
    if (!/^[A-Za-z0-9_.\-]{1,80}$/.test(conta) || !(valor >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroPedido('Pedido inválido.');
    let existe = false;
    await alterar((e) => {
      const contas = (e.cols.config && e.cols.config.main && e.cols.config.main.contas) || [];
      existe = contas.some((c) => c.id === conta);
      if (!existe) return;
      e.cols.ajustes = e.cols.ajustes || {};
      e.cols.ajustes[data + '-' + conta] = { contaId: conta, valor: Math.round(valor * 100) / 100, data, criadoEm: new Date().toISOString() };
    });
    if (!existe) throw new ErroPedido('Conta não encontrada.', 404);
    return json({ ok: true, pendente: { conta, valor, data } });
  } catch (e) {
    return falha(e);
  }
}
