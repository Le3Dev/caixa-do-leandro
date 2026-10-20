// Preço de fechamento diário de ETFs e ações no exterior (ex.: IBIT, SEURF, XTMWF).
// Fonte principal: gráfico diário público da CNBC (lê OTC como SEURF/XTMWF e ETFs dos EUA como IBIT).
// Se falhar: histórico da Nasdaq (só EUA), depois Yahoo e Stooq (que costumam barrar servidores).
// Devolve { TICKER: { datas: { 'AAAA-MM-DD': preço }, moeda, fonte } }.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function cnbc(ticker) {
  const r = await fetch('https://ts-api.cnbc.com/harmony/app/charts/1M.json?symbol=' + encodeURIComponent(ticker), { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('CNBC ' + ticker + ': ' + r.status);
  const j = await r.json();
  const barras = (j && j.barData && j.barData.priceBars) || [];
  const datas = {};
  barras.forEach((b) => {
    const t = String(b.tradeTime || '');
    const v = Number(b.close);
    if (/^\d{8}/.test(t) && v > 0) datas[t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6, 8)] = Math.round(v * 10000) / 10000;
  });
  const ks = Object.keys(datas).sort();
  if (!ks.length) throw new Error('CNBC ' + ticker + ': sem preços');
  ks.slice(0, Math.max(0, ks.length - 90)).forEach((k) => delete datas[k]);
  return { datas, moeda: 'USD', fonte: 'CNBC' };
}

// Ações e FIIs da B3 (ex.: VALE3): brapi.dev (sem chave para os mais negociados); a CNBC usa o sufixo -BR.
const ehB3 = (t) => /^[A-Z]{4}\d{1,2}$/.test(t);
async function brapi(ticker) {
  if (!ehB3(ticker)) throw new Error('brapi: não é B3');
  const r = await fetch('https://brapi.dev/api/quote/' + encodeURIComponent(ticker) + '?range=3mo&interval=1d', { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('brapi ' + ticker + ': ' + r.status);
  const j = await r.json();
  const res = j && j.results && j.results[0];
  const hist = (res && res.historicalDataPrice) || [];
  const datas = {};
  hist.forEach((h) => {
    const v = Number(h.close);
    if (v > 0 && h.date) datas[new Date((Number(h.date) - 3 * 3600) * 1000).toISOString().slice(0, 10)] = v;
  });
  if (!Object.keys(datas).length) throw new Error('brapi ' + ticker + ': sem preços');
  return { datas, moeda: 'BRL', fonte: 'brapi' };
}
async function cnbcB3(ticker) {
  if (!ehB3(ticker)) throw new Error('CNBC B3: não é B3');
  const p = await cnbc(ticker + '-BR');
  return Object.assign(p, { moeda: 'BRL', fonte: 'CNBC' });
}

async function nasdaq(ticker) {
  const de = new Date(Date.now() - 100 * 864e5).toISOString().slice(0, 10);
  for (const classe of ['etf', 'stocks']) {
    const r = await fetch('https://api.nasdaq.com/api/quote/' + encodeURIComponent(ticker) + '/historical?assetclass=' + classe + '&fromdate=' + de + '&limit=100', { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) continue;
    const j = await r.json();
    const linhas = (j && j.data && j.data.tradesTable && j.data.tradesTable.rows) || [];
    const datas = {};
    linhas.forEach((l) => {
      const m = String(l.date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      const v = Number(String(l.close || '').replace(/[$,]/g, ''));
      if (m && v > 0) datas[m[3] + '-' + m[1] + '-' + m[2]] = v;
    });
    if (Object.keys(datas).length) return { datas, moeda: 'USD', fonte: 'Nasdaq' };
  }
  throw new Error('Nasdaq ' + ticker + ': sem preços');
}

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

async function yahooB3(ticker) {
  const p = await yahoo(ticker + '.SA');
  return Object.assign(p, { moeda: 'BRL' });
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
    const msgs = [];
    const fontes = ehB3(t) ? [brapi, cnbcB3, yahooB3] : [cnbc, nasdaq, yahoo, stooq];
    for (const fonte of fontes) {
      try { out[t] = await fonte(t); return; } catch (e) { msgs.push(String(e && e.message)); }
    }
    erros[t] = msgs.join(' / ');
  }));
  if (Object.keys(erros).length) console.error('preços', erros);
  return { precos: out, erros };
}
