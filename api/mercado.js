import { json, falha, autorizado, alterar, lerEstado, guardarCopia, ErroPedido } from './_lib.js';
import { buscarCotas } from './_cotas.js';
import { buscarPrecos } from './_precos.js';

/* Cotas dos fundos que têm CNPJ em Ajustes e preço diário dos ETFs/ações no exterior que têm código
   (ticker). Guarda até 120 dias de cada um, na mesma coleção "cotas". */
export async function atualizarCotas() {
  const { estado } = await lerEstado();
  const contas = (estado.cols.config && estado.cols.config.main && estado.cols.config.main.contas) || [];
  const cnpjs = contas.map((c) => c.cnpj).filter(Boolean);
  // fundos com ETF de referência (proxy): a prévia da cota anda com ele até a cota oficial sair
  const proxies = contas.filter((c) => c.cnpj && c.proxy).map((c) => c.proxy);
  const tickers = [...new Set([...contas.map((c) => c.ticker).filter(Boolean), ...proxies])];
  if (!cnpjs.length && !tickers.length) return {};
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const [fundos, bolsa] = await Promise.all([
    cnpjs.length ? buscarCotas(cnpjs, hoje, 2).catch((e) => { console.error('cotas CVM', e); return {}; }) : {},
    tickers.length ? buscarPrecos(tickers) : { precos: {}, erros: {} },
  ]);
  const novas = Object.assign({}, fundos, Object.fromEntries(Object.entries(bolsa.precos).map(([t, p]) => [t, p.datas])));
  await alterar((e) => {
    e.cols.cotas = e.cols.cotas || {};
    for (const [chave, datas] of Object.entries(novas)) {
      const p = bolsa.precos[chave];
      const doc = e.cols.cotas[chave] = e.cols.cotas[chave] || (p ? { ticker: chave, datas: {} } : { cnpj: chave, datas: {} });
      Object.assign(doc.datas, datas);
      if (p) { doc.moeda = p.moeda || doc.moeda || null; doc.fonte = p.fonte; }
      const ks = Object.keys(doc.datas).sort();
      ks.slice(0, Math.max(0, ks.length - 120)).forEach((k) => delete doc.datas[k]);
      doc.atualizadoEm = new Date().toISOString();
    }
    // prévia: depois da última cota oficial, a cota anda com o ETF de referência (calibrado: beta ~1, sem câmbio)
    for (const c of contas) {
      if (!c.cnpj) continue;
      const doc = e.cols.cotas[c.cnpj];
      // sem ETF de referência: só a cota oficial (igual à XP)
      if (!c.proxy) { if (doc) { delete doc.previa; delete doc.previaDe; } continue; }
      const px = e.cols.cotas[c.proxy] && e.cols.cotas[c.proxy].datas;
      if (!doc || !px) { if (doc) delete doc.previa; continue; }
      const ks = Object.keys(doc.datas).sort();
      const ult = ks[ks.length - 1];
      const pk = Object.keys(px).sort();
      const base = pk.filter((k) => k <= ult).pop();
      const beta = Number(c.proxyBeta) || 1;
      const previa = {};
      if (ult && base) {
        pk.filter((k) => k > ult && k <= hoje).forEach((k) => {
          previa[k] = Math.round(doc.datas[ult] * (1 + beta * (px[k] / px[base] - 1)) * 1e8) / 1e8;
        });
      }
      if (Object.keys(previa).length) { doc.previa = previa; doc.previaDe = c.proxy; } else { delete doc.previa; delete doc.previaDe; }
    }
  });
  const resumo = Object.fromEntries(Object.entries(novas).map(([c, d]) => { const ks = Object.keys(d).sort(); return [c, { dias: ks.length, ultima: ks[ks.length - 1], cota: d[ks[ks.length - 1]] }]; }));
  for (const [t, m] of Object.entries(bolsa.erros)) resumo[t] = { erro: m };
  return resumo;
}

// Dólar PTAX de venda, CDI anualizado, Selic meta e IPCA de 12 meses, direto do Banco Central.
// GET  /api/mercado → chamado pelo cron da Vercel todo dia útil (Authorization: Bearer CRON_SECRET)
// POST /api/mercado → botão "Atualizar agora" no app (precisa estar logado)

const SERIES = { dolar: 1, cdi: 4389, selic: 432, ipca: 13522, ipcaMes: 433 };
const INDICES = [
  { id: 'ibovespa', nome: 'Ibovespa', yahoo: '^BVSP', stooq: '^BVSP', moeda: 'BRL' },
  { id: 'ifix', nome: 'IFIX', yahoo: '^IFIX', stooq: '^IFIX', moeda: 'BRL' },
  { id: 'sp500', nome: 'S&P 500', yahoo: '^GSPC', stooq: '^SPX', moeda: 'USD' },
  { id: 'nasdaq', nome: 'Nasdaq', yahoo: '^IXIC', stooq: '^NDQ', moeda: 'USD' },
  { id: 'dowjones', nome: 'Dow Jones', yahoo: '^DJI', stooq: '^DJI', moeda: 'USD' },
  { id: 'nikkei', nome: 'Nikkei 225', yahoo: '^N225', stooq: '^NKX', moeda: 'JPY' },
];

const brParaIso = (d) => {
  const [dia, mes, ano] = String(d).split('/');
  return `${ano}-${mes}-${dia}`;
};

async function serie(codigo, n) {
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados/ultimos/${n}?formato=json`;
  let ultimoErro;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`BCB ${codigo}: ${r.status}`);
      const lista = await r.json();
      const pontos = lista
        .map((x) => ({ data: brParaIso(x.data), valor: Number(x.valor) }))
        .filter((x) => Number.isFinite(x.valor) && /^\d{4}-\d{2}-\d{2}$/.test(x.data))
        .sort((a, b) => a.data.localeCompare(b.data));
      if (!pontos.length) throw new Error(`BCB ${codigo}: vazio`);
      return pontos;
    } catch (e) {
      ultimoErro = e;
    }
  }
  throw ultimoErro;
}

async function serieYahoo(simbolo, dias = 2200) {
  const range = dias >= 1200 ? '5y' : (dias >= 250 ? '1y' : '6mo');
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=${range}&interval=1d&includePrePost=false`;
  const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Yahoo ${simbolo}: ${r.status}`);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !Array.isArray(res.timestamp)) throw new Error(`Yahoo ${simbolo}: sem dados`);
  const off = Number(res.meta && res.meta.gmtoffset) || 0;
  const fecha = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const pontos = [];
  res.timestamp.forEach((t, i) => {
    const valor = Number(fecha[i]);
    if (!(valor > 0)) return;
    pontos.push({
      data: new Date((t + off) * 1000).toISOString().slice(0, 10),
      valor: Math.round(valor * 10000) / 10000,
    });
  });
  if (!pontos.length) throw new Error(`Yahoo ${simbolo}: vazio`);
  const unicos = {};
  pontos.forEach((p) => { unicos[p.data] = p.valor; });
  const datas = Object.keys(unicos).sort();
  const recorte = datas.slice(Math.max(0, datas.length - dias));
  return {
    dados: Object.fromEntries(recorte.map((d) => [d, unicos[d]])),
    moeda: (res.meta && res.meta.currency) || null,
    fonte: 'Yahoo Finance',
  };
}

async function serieStooq(simbolo, dias = 2200) {
  const s = String(simbolo || '').toLowerCase();
  const r = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Stooq ${simbolo}: ${r.status}`);
  const linhas = (await r.text()).trim().split('\n');
  const cab = (linhas.shift() || '').toLowerCase().split(',');
  const iD = cab.indexOf('date');
  const iC = cab.indexOf('close');
  if (iD < 0 || iC < 0) throw new Error(`Stooq ${simbolo}: formato`);
  const dados = {};
  linhas.forEach((linha) => {
    const c = linha.split(',');
    const data = c[iD];
    const valor = Number(c[iC]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(data) && valor > 0) dados[data] = valor;
  });
  const datas = Object.keys(dados).sort();
  if (!datas.length) throw new Error(`Stooq ${simbolo}: vazio`);
  const recorte = datas.slice(Math.max(0, datas.length - dias));
  return { dados: Object.fromEntries(recorte.map((d) => [d, dados[d]])), moeda: null, fonte: 'Stooq' };
}

async function buscarIndices() {
  const resultados = {};
  const falhas = {};
  await Promise.all(INDICES.map(async (idx) => {
    const erros = [];
    for (const fonte of [
      () => serieYahoo(idx.yahoo, 2200),
      () => serieStooq(idx.stooq || idx.yahoo, 2200),
    ]) {
      try {
        resultados[idx.id] = await fonte();
        return;
      } catch (e) {
        erros.push(String(e && e.message));
      }
    }
    falhas[idx.id] = erros.join(' / ');
  }));
  if (Object.keys(falhas).length) console.error('indices', falhas);
  return { resultados, falhas };
}

async function atualizar() {
  const [dolar, cdi, selic, ipca, ipcaMes] = await Promise.allSettled([
    serie(SERIES.dolar, 10), serie(SERIES.cdi, 10), serie(SERIES.selic, 1), serie(SERIES.ipca, 1), serie(SERIES.ipcaMes, 20),
  ]);
  const indices = await buscarIndices().catch((e) => {
    console.error('indices', e);
    return { resultados: {}, falhas: { geral: String(e && e.message) } };
  });
  const ok = (r) => (r.status === 'fulfilled' ? r.value : null);
  const falhas = Object.keys(SERIES).filter((k, i) => [dolar, cdi, selic, ipca, ipcaMes][i].status !== 'fulfilled');
  if (falhas.length === 5) throw new ErroPedido('O Banco Central não respondeu. Tente mais tarde.', 502);

  const estado = await alterar((e) => {
    const m = e.cols.mercado = e.cols.mercado || {};
    const atual = Object.assign({}, m.atual);
    const d = ok(dolar), c = ok(cdi), s = ok(selic), i = ok(ipca), im = ok(ipcaMes);
    if (d) { const u = d[d.length - 1]; atual.dolar = u.valor; atual.dolarData = u.data; }
    if (c) { const u = c[c.length - 1]; atual.cdi = u.valor; atual.cdiData = u.data; }
    if (s) atual.selic = s[s.length - 1].valor;
    if (i) { const u = i[i.length - 1]; atual.ipca12m = u.valor; atual.ipcaData = u.data; }
    // IPCA de cada mês, para os CDBs de inflação andarem como na corretora
    if (im) atual.ipcaMes = Object.fromEntries(im.map((p) => [p.data.slice(0, 7), p.valor]));
    const idxOut = {};
    for (const idx of INDICES) {
      const got = indices.resultados[idx.id];
      if (!got || !got.dados) continue;
      const ds = Object.keys(got.dados).sort();
      const ult = ds[ds.length - 1];
      const ant = ds.length > 1 ? ds[ds.length - 2] : null;
      const valor = Number(got.dados[ult]);
      const valorAnt = ant ? Number(got.dados[ant]) : null;
      const variacaoDia = Number.isFinite(valorAnt) && valorAnt > 0 ? valor - valorAnt : null;
      idxOut[idx.id] = {
        id: idx.id,
        nome: idx.nome,
        moeda: got.moeda || idx.moeda || null,
        fonte: got.fonte,
        data: ult,
        valor,
        anteriorData: ant,
        anteriorValor: Number.isFinite(valorAnt) ? valorAnt : null,
        variacaoDia,
        variacaoDiaPct: Number.isFinite(variacaoDia) && valorAnt > 0 ? (variacaoDia / valorAnt) * 100 : null,
      };
    }
    if (Object.keys(idxOut).length) atual.indices = idxOut;
    atual.fonte = 'Banco Central (SGS 1, 4389, 432, 13522 e 433)';
    atual.atualizadoEm = new Date().toISOString();
    m.atual = atual;
    // um ponto por dia com o dólar e o CDI daquele dia, para o gráfico de evolução
    const hist = e.cols.mercado_hist = e.cols.mercado_hist || {};
    if (d) {
      for (const p of d) {
        if (hist[p.data]) continue;
        const cdiDia = c ? [...c].reverse().find((x) => x.data <= p.data) : null;
        hist[p.data] = { data: p.data, dolar: p.valor, cdi: cdiDia ? cdiDia.valor : atual.cdi ?? null };
      }
    }
    for (const idx of INDICES) {
      const got = indices.resultados[idx.id];
      if (!got || !got.dados) continue;
      for (const [data, valor] of Object.entries(got.dados)) {
        hist[data] = hist[data] || { data };
        hist[data].indices = hist[data].indices || {};
        hist[data].indices[idx.id] = Number(valor);
      }
    }
    const hs = Object.keys(hist).sort();
    hs.slice(0, Math.max(0, hs.length - 2200)).forEach((k) => delete hist[k]);
  });
  try { await atualizarCotas(); } catch (e) { console.error('cotas', e); }
  // aproveita a passada diária para guardar a cópia do mês
  try { await guardarCopia(estado); } catch (e) { console.error('cópia', e); }
  return { atual: estado.cols.mercado.atual, falhas };
}

export async function GET(request) {
  // Chamado pelo cron. Se CRON_SECRET existir, exige o cabeçalho da Vercel.
  // Sem ele, só busca dados públicos do Banco Central e no máximo a cada 30 minutos.
  const segredo = process.env.CRON_SECRET;
  if (segredo && request.headers.get('authorization') !== `Bearer ${segredo}`) {
    return json({ erro: 'não autorizado' }, 401);
  }
  try {
    if (!segredo) {
      const { estado } = await lerEstado();
      const atual = estado.cols && estado.cols.mercado && estado.cols.mercado.atual;
      if (atual && atual.ipcaMes && atual.atualizadoEm && Date.now() - Date.parse(atual.atualizadoEm) < 30 * 60 * 1000) {
        return json({ atual, falhas: [], recente: true });
      }
    }
    return json(await atualizar());
  } catch (e) {
    return falha(e);
  }
}

export async function POST(request) {
  if (!autorizado(request)) return json({ erro: 'login' }, 401);
  try {
    return json(await atualizar());
  } catch (e) {
    return falha(e);
  }
}
