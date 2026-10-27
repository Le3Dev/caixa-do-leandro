import crypto from 'node:crypto';
import { json, falha, alterar, ErroPedido } from './_lib.js';
import { atualizarCotas } from './mercado.js';
import { tickerOk } from './_precos.js';

// GET /api/ajuste?codigo=<código>&conta=<id>&valor=<valor na moeda da conta>&data=AAAA-MM-DD[&ref=AAAA-MM-DD]
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
    // ?exportar=1 devolve os dados (sem as inscrições de notificação), para conferir contas fora do app
    if (u.searchParams.has('exportar')) {
      const { lerEstado } = await import('./_lib.js');
      const { estado } = await lerEstado();
      const de = u.searchParams.get('desde');
      if (!de) return json({ cols: estado.cols });
      // só o que entra na conta dos investimentos, a partir de uma data (para conferir o cálculo)
      const c = estado.cols;
      const corta = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => k >= de));
      const cotas = Object.fromEntries(Object.entries(c.cotas || {}).map(([k, d]) => [k, Object.assign({}, d, { datas: corta(d.datas) })]));
      return json({ cols: { config: c.config, checkins: c.checkins, aportes: c.aportes, mercado: c.mercado, mercado_hist: corta(c.mercado_hist), cotas, ajustes: c.ajustes } });
    }
    // ?reserva=<valor> muda a meta da reserva de emergência
    if (u.searchParams.has('reserva')) {
      const v = Number(u.searchParams.get('reserva'));
      if (!(v > 0)) throw new ErroPedido('Valor inválido.');
      await alterar((e) => {
        const cfg = e.cols.config && e.cols.config.main;
        if (cfg) cfg.reserva = Object.assign({}, cfg.reserva, { valor: Math.round(v * 100) / 100 });
      });
      return json({ ok: true, reserva: v });
    }
    // ?nova=1&conta=<id>&nome=<nome>&lugar=<onde>&moeda=BRL|USD cria uma conta de investimento
    if (u.searchParams.has('nova')) {
      if (!/^[a-z0-9_\-]{2,40}$/.test(conta)) throw new ErroPedido('Id inválido.');
      const nome = (u.searchParams.get('nome') || '').trim().slice(0, 60);
      const lugar = (u.searchParams.get('lugar') || '').trim().slice(0, 60) || '—';
      const moeda = u.searchParams.get('moeda') === 'USD' ? 'USD' : 'BRL';
      if (!nome) throw new ErroPedido('Nome vazio.');
      let criada = false;
      await alterar((e) => {
        const cfg = e.cols.config && e.cols.config.main;
        if (!cfg) return;
        cfg.contas = cfg.contas || [];
        const c = cfg.contas.find((x) => x.id === conta);
        if (c) Object.assign(c, { nome, lugar, moeda });
        else cfg.contas.push({ id: conta, nome, lugar, tipo: 'investimento', moeda, indexador: '', taxa: null });
        criada = !c;
      });
      return json({ ok: true, conta, criada });
    }
    // ?conta=<id>&ticker=<código> faz a conta andar com o preço diário daquele ETF/ação e já busca os preços
    if (u.searchParams.has('ticker')) {
      const ticker = (u.searchParams.get('ticker') || '').trim().toUpperCase();
      if (ticker && !tickerOk(ticker)) throw new ErroPedido('Código inválido.');
      let achou = false;
      await alterar((e) => {
        const c = ((e.cols.config && e.cols.config.main && e.cols.config.main.contas) || []).find((x) => x.id === conta);
        if (!c) return;
        achou = true;
        if (ticker) c.ticker = ticker; else delete c.ticker;
      });
      if (!achou) throw new ErroPedido('Conta não encontrada.', 404);
      return json({ ok: true, conta, ticker, cotas: await atualizarCotas() });
    }
    // ?conta=<id>&proxy=<ETF>[&beta=1] dá ao fundo um ETF de referência para a prévia da cota (vazio tira)
    if (u.searchParams.has('proxy')) {
      const proxy = (u.searchParams.get('proxy') || '').trim().toUpperCase();
      if (proxy && !tickerOk(proxy)) throw new ErroPedido('Código inválido.');
      const beta = Number(u.searchParams.get('beta')) || 1;
      let achou = false;
      await alterar((e) => {
        const c = ((e.cols.config && e.cols.config.main && e.cols.config.main.contas) || []).find((x) => x.id === conta);
        if (!c) return;
        achou = true;
        if (proxy) { c.proxy = proxy; c.proxyBeta = beta; } else { delete c.proxy; delete c.proxyBeta; }
      });
      if (!achou) throw new ErroPedido('Conta não encontrada.', 404);
      await atualizarCotas();
      const { lerEstado } = await import('./_lib.js');
      const { estado } = await lerEstado();
      const c = ((estado.cols.config.main.contas) || []).find((x) => x.id === conta);
      const doc = c && c.cnpj && estado.cols.cotas[c.cnpj];
      return json({ ok: true, conta, proxy, beta, ultimaOficial: doc && Object.keys(doc.datas).sort().slice(-2).map((k) => [k, doc.datas[k]]), previa: doc && doc.previa });
    }
    // ?checkin=AAAA-MM-DD&conta=<id>[&valor=<valor>][&ref=AAAA-MM-DD|-] corrige um item de um check-in que já existe
    if (u.searchParams.has('checkin')) {
      const data = u.searchParams.get('checkin') || '';
      const ref = u.searchParams.get('ref');
      const valor = u.searchParams.has('valor') ? Number(u.searchParams.get('valor')) : null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || (valor != null && !(valor >= 0)) || (ref && ref !== '-' && !/^\d{4}-\d{2}-\d{2}$/.test(ref))) throw new ErroPedido('Pedido inválido.');
      // &fluxo=<valor> anota que esse valor entrou (+) ou saiu (−) da conta nesse dia sem ser rendimento
      const fluxo = u.searchParams.has('fluxo') ? Number(u.searchParams.get('fluxo')) : null;
      let item = null;
      await alterar((e) => {
        const ck = e.cols.checkins && e.cols.checkins[data];
        if (!ck) return;
        let it = (ck.itens || []).find((x) => x.id === conta);
        if (!it) {
          // conta nova nesse check-in: entra com os dados de Ajustes
          const c = ((e.cols.config && e.cols.config.main && e.cols.config.main.contas) || []).find((x) => x.id === conta);
          if (!c || valor == null) return;
          it = { id: c.id, nome: c.nome, lugar: c.lugar, tipo: c.tipo, moeda: c.moeda, valor: 0 };
          ck.itens.push(it);
        }
        if (valor != null) it.valor = Math.round(valor * 10000) / 10000;
        if (ref === '-') delete it.cotaRef; else if (ref) it.cotaRef = ref;
        if (fluxo != null && Number.isFinite(fluxo)) {
          ck.fluxos = (ck.fluxos || []).filter((f) => f.conta !== conta);
          if (fluxo) ck.fluxos.push({ conta, valor: Math.round(fluxo * 100) / 100, desc: (u.searchParams.get('desc') || '').slice(0, 60) || null });
          if (!ck.fluxos.length) delete ck.fluxos;
        }
        // os lançamentos de hoje registrados antes disso já estão nos valores
        if (u.searchParams.has('agora')) ck.salvoEm = new Date().toISOString();
        item = Object.assign({}, it);
      });
      if (!item) throw new ErroPedido('Check-in ou conta não encontrados.', 404);
      return json({ ok: true, data, item });
    }
    // ?custo=<valor>&moeda=USD|BRL&data=AAAA-MM-DD[&inst=XP][&desc=Corretagem] anota um custo (ex.: corretagem)
    // no check-in daquele dia: sai da carteira como retirada e não conta como perda de rendimento. custo=0 tira.
    if (u.searchParams.has('custo')) {
      const valor = Number(u.searchParams.get('custo'));
      const data = u.searchParams.get('data') || '';
      const moeda = u.searchParams.get('moeda') === 'USD' ? 'USD' : 'BRL';
      const inst = (u.searchParams.get('inst') || '').trim().slice(0, 30) || null;
      const desc = (u.searchParams.get('desc') || 'Corretagem').trim().slice(0, 60);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !(valor >= 0)) throw new ErroPedido('Pedido inválido.');
      let achou = false;
      await alterar((e) => {
        const ck = e.cols.checkins && e.cols.checkins[data];
        if (!ck) return;
        achou = true;
        if (valor > 0) ck.custos = [{ valor: Math.round(valor * 100) / 100, moeda, inst, desc }];
        else delete ck.custos;
      });
      if (!achou) throw new ErroPedido('Não há check-in nesse dia.', 404);
      return json({ ok: true, data, custo: valor, moeda, inst });
    }
    // ?conta=<id>&lugar=<texto> muda onde a conta fica (ex.: "XP · conta em dólar")
    if (u.searchParams.has('lugar')) {
      const lugar = (u.searchParams.get('lugar') || '').trim().slice(0, 60);
      if (!lugar) throw new ErroPedido('Lugar vazio.');
      let achou = false;
      await alterar((e) => {
        const c = ((e.cols.config && e.cols.config.main && e.cols.config.main.contas) || []).find((x) => x.id === conta);
        if (c) { c.lugar = lugar; achou = true; }
      });
      if (!achou) throw new ErroPedido('Conta não encontrada.', 404);
      return json({ ok: true, conta, lugar });
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
      // ref=AAAA-MM-DD: o valor informado corresponde ao preço/cota desse dia (ex.: compra feita no fechamento)
      const ref = u.searchParams.get('ref') || '';
      e.cols.ajustes[data + '-' + conta] = Object.assign({ contaId: conta, valor: Math.round(valor * 100) / 100, data, criadoEm: new Date().toISOString() }, /^\d{4}-\d{2}-\d{2}$/.test(ref) ? { cotaRef: ref } : {}, Number(u.searchParams.get('fluxo')) ? { fluxo: Number(u.searchParams.get('fluxo')), desc: (u.searchParams.get('desc') || '').slice(0, 60) || null } : {});
    });
    if (!existe) throw new ErroPedido('Conta não encontrada.', 404);
    return json({ ok: true, pendente: { conta, valor, data } });
  } catch (e) {
    return falha(e);
  }
}
