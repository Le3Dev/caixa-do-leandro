// Preço de fechamento diário de ETFs e ações no exterior (ex.: IBIT, SEURF, XTMWF).
// Fonte principal: gráfico diário do Yahoo Finance; se falhar, o CSV diário do Stooq.
// Devolve { TICKER: { datas: { 'AAAA-MM-DD': preço }, moeda, fonte } }.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function yahoo(ticker) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker) + '?range=3mo&interval=1d&includePrePost=false';
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Yahoo ' + ticker + ': ' + r.status);
  const j = await r.json();
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !Array.isArray(res.timestamp)) throw new Error('Yahoo ' + ticker + ': sem dados');
  const off = Number(res.meta && res.meta.gmtoffset) || 0;
  const fech = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const datas = {};
  res.timestamp.forEach((t, i) => {
    const v = Number(fech[i]);
    if (v > 0) datas[new Date((t + off) * 1000).toISOString().slice(0, 10)] = Math.round(v * 10000) / 10000;
  });
  if (!Object.keys(datas).length) throw new Error('Yahoo ' + ticker + ': sem preços');
  return { datas, moeda: (res.meta && res.meta.currency) || null, fonte: 'Yahoo Finance' };
}

async function stooq(ticker) {
  const s = ticker.includes('.') ? ticker.toLowerCase().replace(/\.l$/, '.uk') : ticker.toLowerCase() + '.us';
  const r = await fetch('https://stooq.com/q/d/l/?s=' + encodeURIComponent(s) + '&i=d', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('Stooq ' + ticker + ': ' + r.status);
  const linhas = (await r.text()).trim().split('\n');
  const cab = (linhas.shift() || '').toLowerCase().split(',');
  const iD = cab.indexOf('date'), iC = cab.indexOf('close');
  if (iD < 0 || iC < 0) throw new Error('Stooq ' + ticker + ': formato');
  const datas = {};
  linhas.slice(-90).forEach((l) => {
    const c = l.split(',');
    const v = Number(c[iC]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(c[iD]) && v > 0) datas[c[iD]] = v;
  });
  if (!Object.keys(datas).length) throw new Error('Stooq ' + ticker + ': sem preços');
  return { datas, moeda: null, fonte: 'Stooq' };
}

export const tickerOk = (t) => /^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/.test(String(t || ''));

export async function buscarPrecos(tickers) {
  const out = {};
  const erros = {};
  await Promise.all([...new Set(tickers.filter(tickerOk))].map(async (t) => {
    try { out[t] = await yahoo(t); } catch (e1) {
      try { out[t] = await stooq(t); } catch (e2) { erros[t] = String(e1.message) + ' / ' + String(e2.message); }
    }
  }));
  if (Object.keys(erros).length) console.error('preços', erros);
  return { precos: out, erros };
}
