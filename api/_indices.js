// Índices de mercado (Ibovespa, IFIX, S&P 500, Nasdaq, Dow Jones e Nikkei 225), buscados na hora.
// Camada anticorrupção: conversa com o Yahoo Finance (principal) e com a CNBC (reserva) e devolve tudo
// no modelo do app — pontos { t, data, valor } com a data local da bolsa, a sessão atual e o resumo.
// Não usa _lib.js de propósito: dá para testar sozinho.

// O Yahoo responde 429 para pedidos sem user-agent de navegador (e para alguns user-agents de navegador também).
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const UA_RESERVA = 'Mozilla/5.0';
const TEMPO_LIMITE = 15000;

const UM_MINUTO = 60 * 1000;
const CINCO_MINUTOS = 5 * UM_MINUTO;
const QUINZE_MINUTOS = 15 * UM_MINUTO;
const SEIS_HORAS = 6 * 60 * UM_MINUTO;

// IFIX: o Yahoo não tem ^IFIX; IFIX.SA só traz o intradiário, e o histórico vem da CNBC.
export const INDICES = [
  { id: 'ibovespa', nome: 'Ibovespa', yahoo: '^BVSP', cnbc: '.BVSP', moeda: 'BRL', fuso: 'America/Sao_Paulo' },
  { id: 'ifix', nome: 'IFIX', yahoo: 'IFIX.SA', cnbc: '.IFIX', moeda: 'BRL', fuso: 'America/Sao_Paulo' },
  { id: 'sp500', nome: 'S&P 500', yahoo: '^GSPC', cnbc: '.SPX', moeda: 'USD', fuso: 'America/New_York' },
  { id: 'nasdaq', nome: 'Nasdaq', yahoo: '^IXIC', cnbc: '.IXIC', moeda: 'USD', fuso: 'America/New_York' },
  { id: 'dowjones', nome: 'Dow Jones', yahoo: '^DJI', cnbc: '.DJI', moeda: 'USD', fuso: 'America/New_York' },
  { id: 'nikkei', nome: 'Nikkei 225', yahoo: '^N225', cnbc: '.N225', moeda: 'JPY', fuso: 'Asia/Tokyo' },
];

// cnbc: gráficos a tentar, em ordem. Os diários da CNBC vêm maiores que o nome (o 1M traz ~1 ano) e
// o 6M/YTD chegam com um dia de atraso, por isso 6M e YTD saem do 1M.
const CONFIG_PERIODO = {
  '1D': { range: '1d', interval: '5m', cnbc: ['1D'], intradiario: true, validade: UM_MINUTO },
  '5D': { range: '5d', interval: '15m', cnbc: ['5D'], intradiario: true, validade: UM_MINUTO },
  '1M': { range: '1mo', interval: '1d', cnbc: ['1M'], validade: CINCO_MINUTOS },
  '6M': { range: '6mo', interval: '1d', cnbc: ['1M', '6M'], validade: QUINZE_MINUTOS },
  'YTD': { range: 'ytd', interval: '1d', cnbc: ['1M', 'YTD'], validade: QUINZE_MINUTOS },
  '1A': { range: '1y', interval: '1d', cnbc: ['1Y'], validade: QUINZE_MINUTOS },
  '5A': { range: '5y', interval: '1wk', cnbc: ['5Y'], validade: QUINZE_MINUTOS },
  'MAX': { range: 'max', interval: '1mo', cnbc: ['ALL'], validade: QUINZE_MINUTOS },
};
export const PERIODOS = Object.keys(CONFIG_PERIODO);

// Só para o teste local simular a queda de uma fonte; em produção fica tudo ligado.
export const paraTestes = { semYahoo: false, semCnbc: false, limparCache: () => CACHE.clear() };

// Erro de "nenhuma fonte respondeu": a mensagem vai para o usuário, os detalhes para o log.
export class ErroDeFonte extends Error {
  constructor(idx, erros) {
    super('Não consegui buscar o ' + idx.nome + ' agora. Tente de novo em alguns minutos.');
    this.detalhes = erros.join(' / ');
  }
}

/* ---------- utilidades ---------- */
const arred = (v) => Math.round(v * 10000) / 10000;
const positivo = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const maximo = (l) => { const v = l.filter((x) => x > 0); return v.length ? Math.max(...v) : null; };
const minimo = (l) => { const v = l.filter((x) => x > 0); return v.length ? Math.min(...v) : null; };
const msg = (e) => String((e && e.message) || e);

const FORMATOS = new Map();
// Data 'AAAA-MM-DD' no fuso da bolsa (respeita horário de verão); sem o fuso, usa o deslocamento do Yahoo.
function dataLocal(ms, fuso, deslocamentoSeg) {
  if (fuso) {
    try {
      let f = FORMATOS.get(fuso);
      if (!f) {
        f = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' });
        FORMATOS.set(fuso, f);
      }
      return f.format(new Date(ms));
    } catch { /* fuso desconhecido: cai no deslocamento */ }
  }
  return new Date(ms + (Number(deslocamentoSeg) || 0) * 1000).toISOString().slice(0, 10);
}
function menosMeses(iso, meses) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1 - meses, d)).toISOString().slice(0, 10);
}
function maisDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}
function inicioDoPeriodo(periodo, fim) {
  if (periodo === '1M') return menosMeses(fim, 1);
  if (periodo === '6M') return menosMeses(fim, 6);
  if (periodo === 'YTD') return fim.slice(0, 4) + '-01-01';
  if (periodo === '1A') return menosMeses(fim, 12);
  if (periodo === '5A') return menosMeses(fim, 60);
  return null;
}
// ordena por horário e tira repetidos
function ordenar(barras) {
  const vistos = new Map();
  barras.forEach((b) => vistos.set(b.t, b));
  return [...vistos.values()].sort((a, b) => a.t - b.t);
}
// um ponto por dia (fica o último)
function umPorDia(barras) {
  const dias = new Map();
  ordenar(barras).forEach((b) => dias.set(b.data, b));
  return [...dias.values()];
}
function agruparPorDia(barras) {
  const grupos = [];
  barras.forEach((b) => {
    const g = grupos[grupos.length - 1];
    if (g && g.data === b.data) g.barras.push(b);
    else grupos.push({ data: b.data, barras: [b] });
  });
  return grupos;
}
const paraPonto = (b) => ({ t: b.t, data: b.data, valor: b.valor });

function indicePorId(id) {
  const idx = INDICES.find((i) => i.id === id);
  if (!idx) throw new Error('Índice desconhecido: "' + id + '". Use ' + INDICES.map((i) => i.id).join(', ') + '.');
  return idx;
}

/* ---------- cache em memória (vale enquanto a função da Vercel estiver quente) ---------- */
const CACHE = new Map(); // chave → { em, valor }
const EM_ANDAMENTO = new Map(); // chave → Promise (pedidos iguais ao mesmo tempo viram um só)

async function comCache(chave, validade, buscar) {
  const c = CACHE.get(chave);
  if (c && Date.now() - c.em < validade) return c.valor;
  if (EM_ANDAMENTO.has(chave)) return EM_ANDAMENTO.get(chave);
  const pedido = (async () => {
    try {
      const valor = await buscar();
      CACHE.set(chave, { em: Date.now(), valor });
      return valor;
    } catch (e) {
      // fonte fora do ar: serve o último dado bom, se tiver menos de 6h
      if (c && Date.now() - c.em < SEIS_HORAS) {
        console.error('índices: usando cache de ' + chave, (e && e.detalhes) || msg(e));
        return c.valor;
      }
      throw e;
    } finally {
      EM_ANDAMENTO.delete(chave);
    }
  })();
  EM_ANDAMENTO.set(chave, pedido);
  return pedido;
}

/* ---------- fachada do Yahoo Finance ---------- */
async function pedirYahoo(caminho, rotulo) {
  if (paraTestes.semYahoo) throw new Error('Yahoo ' + rotulo + ': desligado no teste');
  const erros = [];
  for (const [host, ua] of [['query1', UA], ['query2', UA_RESERVA]]) {
    try {
      const r = await fetch('https://' + host + '.finance.yahoo.com' + caminho, { headers: { 'user-agent': ua, accept: 'application/json' }, signal: AbortSignal.timeout(TEMPO_LIMITE) });
      if (!r.ok) throw new Error('Yahoo ' + rotulo + ' (' + host + '): ' + r.status);
      return await r.json();
    } catch (e) {
      erros.push(msg(e));
    }
  }
  throw new Error(erros.join(' / '));
}

async function yahooGrafico(simbolo, range, interval) {
  const j = await pedirYahoo('/v8/finance/chart/' + encodeURIComponent(simbolo) + '?range=' + range + '&interval=' + interval + '&includePrePost=false', simbolo);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.meta) throw new Error('Yahoo ' + simbolo + ': sem dados');
  return res;
}

// Vários índices numa chamada só (máx. 20 símbolos); cada item tem o mesmo formato do gráfico.
async function yahooSpark(simbolos) {
  const j = await pedirYahoo('/v7/finance/spark?symbols=' + encodeURIComponent(simbolos.join(',')) + '&range=1d&interval=5m', 'spark');
  const lista = (j && j.spark && j.spark.result) || [];
  const saida = {};
  lista.forEach((x) => {
    const res = x && x.response && x.response[0];
    if (res && res.meta) saida[x.symbol] = res;
  });
  if (!Object.keys(saida).length) throw new Error('Yahoo spark: sem dados');
  return saida;
}

/* ---------- adaptador do Yahoo ---------- */
function barrasYahoo(res, idx) {
  const m = res.meta || {};
  const fuso = m.exchangeTimezoneName || idx.fuso;
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const barras = [];
  (Array.isArray(res.timestamp) ? res.timestamp : []).forEach((s, i) => {
    const valor = positivo(q.close && q.close[i]);
    if (!valor || !Number.isFinite(Number(s))) return;
    const t = Number(s) * 1000;
    barras.push({
      t,
      data: dataLocal(t, fuso, m.gmtoffset),
      abertura: positivo(q.open && q.open[i]),
      alta: positivo(q.high && q.high[i]),
      baixa: positivo(q.low && q.low[i]),
      valor: arred(valor),
    });
  });
  return ordenar(barras);
}

// Sessão atual (ou a última, com a bolsa fechada) a partir do gráfico de 1 dia.
function sessaoDoYahoo(res, idx) {
  const m = res.meta || {};
  const fuso = m.exchangeTimezoneName || idx.fuso;
  const barras = barrasYahoo(res, idx);
  const ultimaData = barras.length ? barras[barras.length - 1].data : null;
  const daSessao = barras.filter((b) => b.data === ultimaData);
  const ultima = daSessao[daSessao.length - 1];
  const valor = positivo(m.regularMarketPrice) || (ultima && ultima.valor);
  if (!valor) throw new Error('Yahoo ' + idx.yahoo + ': sem cotação');
  const t = positivo(m.regularMarketTime) ? m.regularMarketTime * 1000 : (ultima && ultima.t);
  const agora = Date.now();
  // aberto = dentro do horário regular e com cotação recente (75 min cobre o almoço de Tóquio);
  // nos primeiros 30 min confia só no horário, porque a B3 chega ao Yahoo com ~15 min de atraso.
  const reg = m.currentTradingPeriod && m.currentTradingPeriod.regular;
  const ini = reg && Number(reg.start) * 1000;
  const fim = reg && Number(reg.end) * 1000;
  const dentro = Boolean(ini && fim && agora >= ini && agora < fim);
  const recente = Boolean(t && agora - t < 75 * UM_MINUTO);
  const anterior = positivo(m.previousClose) || positivo(m.chartPreviousClose);
  // máxima/mínima de 52 semanas só valem se o índice tem mais de 1 ano no Yahoo (o IFIX.SA não tem)
  const ftd = m.firstTradeDate;
  const confiavel52 = typeof ftd === 'number' && agora / 1000 - ftd > 365 * 86400;
  const abertura = (daSessao.find((b) => b.abertura) || {}).abertura || null;
  return {
    fonte: 'Yahoo Finance',
    moeda: m.currency || idx.moeda || null,
    valor: arred(valor),
    t: t || null,
    horario: t ? new Date(t).toISOString() : null,
    data: ultimaData || (t ? dataLocal(t, fuso, m.gmtoffset) : null),
    pregaoAberto: dentro && (recente || agora - ini < 30 * UM_MINUTO),
    fechamentoAnterior: anterior ? arred(anterior) : null,
    pontos: daSessao.map(paraPonto),
    resumo: {
      abertura: abertura ? arred(abertura) : null,
      alta: positivo(m.regularMarketDayHigh) || maximo(daSessao.map((b) => b.alta || b.valor)),
      baixa: positivo(m.regularMarketDayLow) || minimo(daSessao.map((b) => b.baixa || b.valor)),
      alta52: confiavel52 ? positivo(m.fiftyTwoWeekHigh) : null,
      baixa52: confiavel52 ? positivo(m.fiftyTwoWeekLow) : null,
    },
  };
}

// O Yahoo às vezes devolve só o último preço num período longo (é o caso do IFIX.SA): aí vale a CNBC.
function conferirCobertura(pontos, periodo, rotulo) {
  if (!pontos.length) throw new Error(rotulo + ': vazio');
  const fim = pontos[pontos.length - 1].data;
  const ini = periodo === 'MAX' ? menosMeses(fim, 12) : inicioDoPeriodo(periodo, fim);
  if (ini && (pontos.length < 2 || pontos[0].data > maisDias(ini, 20))) throw new Error(rotulo + ': histórico incompleto');
}

async function serieDoYahoo(idx, periodo) {
  const cfg = CONFIG_PERIODO[periodo];
  const barras = barrasYahoo(await yahooGrafico(idx.yahoo, cfg.range, cfg.interval), idx);
  const pontos = (cfg.intradiario ? barras : umPorDia(barras)).map(paraPonto);
  if (cfg.intradiario) { if (!pontos.length) throw new Error('Yahoo ' + idx.yahoo + ': vazio'); }
  else conferirCobertura(pontos, periodo, 'Yahoo ' + idx.yahoo);
  return { pontos, fonte: 'Yahoo Finance' };
}

/* ---------- fachada e adaptador da CNBC ---------- */
async function cnbcGrafico(simbolo, periodoCnbc) {
  if (paraTestes.semCnbc) throw new Error('CNBC ' + simbolo + ': desligada no teste');
  const r = await fetch('https://ts-api.cnbc.com/harmony/app/charts/' + periodoCnbc + '.json?symbol=' + encodeURIComponent(simbolo), { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TEMPO_LIMITE) });
  if (!r.ok) throw new Error('CNBC ' + simbolo + ': ' + r.status);
  const j = await r.json();
  const barras = (j && j.barData && j.barData.priceBars) || [];
  if (!barras.length) throw new Error('CNBC ' + simbolo + ': sem dados');
  return barras;
}

// Barras diárias/semanais/mensais trazem a data em tradeTime (AAAAMMDD...); intradiárias usam o fuso da bolsa.
function barrasCnbc(lista, idx, diario) {
  const barras = [];
  lista.forEach((b) => {
    const t = Number(b.tradeTimeinMills);
    const valor = positivo(b.close);
    if (!valor || !Number.isFinite(t)) return;
    const tt = String(b.tradeTime || '');
    const data = diario && /^\d{8}/.test(tt) ? tt.slice(0, 4) + '-' + tt.slice(4, 6) + '-' + tt.slice(6, 8) : dataLocal(t, idx.fuso);
    const arr = (v) => (positivo(v) ? arred(Number(v)) : null);
    barras.push({ t, data, abertura: arr(b.open), alta: arr(b.high), baixa: arr(b.low), valor: arred(valor) });
  });
  return ordenar(barras);
}

// No intradiário, a CNBC põe uma barra "plana" e isolada com o fechamento do dia (fora do pregão e em
// feriados). Ela serve para achar o fechamento anterior, mas não é negociação: sai do gráfico.
function semMarcadores(barras) {
  const perto = (a, b) => a && a.data === b.data && Math.abs(a.t - b.t) <= 60 * UM_MINUTO;
  return barras.filter((b, i) => {
    const plana = b.abertura === b.valor && b.alta === b.valor && b.baixa === b.valor;
    return !plana || perto(barras[i - 1], b) || perto(barras[i + 1], b);
  });
}
function fechamentoAntesDe(barras, data) {
  const antes = barras.filter((b) => b.data < data);
  return antes.length ? antes[antes.length - 1].valor : null;
}

function sessaoDaCnbc(lista, idx) {
  const todas = barrasCnbc(lista, idx, false);
  const reais = semMarcadores(todas);
  if (!reais.length) throw new Error('CNBC ' + idx.cnbc + ': sem preços');
  const sessoes = agruparPorDia(reais);
  const atual = sessoes[sessoes.length - 1].barras;
  const ultima = atual[atual.length - 1];
  const agora = Date.now();
  return {
    fonte: 'CNBC',
    moeda: idx.moeda || null,
    valor: ultima.valor,
    t: ultima.t,
    horario: new Date(ultima.t).toISOString(),
    data: ultima.data,
    // a CNBC não informa o horário do pregão: aberto = cotação de hoje com menos de 20 min
    pregaoAberto: ultima.data === dataLocal(agora, idx.fuso) && agora - ultima.t < 20 * UM_MINUTO,
    fechamentoAnterior: fechamentoAntesDe(todas, ultima.data),
    pontos: atual.map(paraPonto),
    resumo: {
      abertura: atual[0].abertura || null,
      alta: maximo(atual.map((b) => b.alta || b.valor)),
      baixa: minimo(atual.map((b) => b.baixa || b.valor)),
      alta52: null,
      baixa52: null,
    },
  };
}

// Os gráficos diários da CNBC vêm maiores que o período e sem o dia corrente:
// o recorte e o último preço são feitos depois, junto com a sessão.
async function serieDaCnbc(idx, periodo) {
  if (!idx.cnbc) throw new Error('CNBC: sem símbolo para ' + idx.nome);
  const cfg = CONFIG_PERIODO[periodo];
  const erros = [];
  for (const [i, grafico] of cfg.cnbc.entries()) {
    try {
      const lista = await cnbcGrafico(idx.cnbc, grafico);
      let barras;
      if (cfg.intradiario) {
        const sessoes = agruparPorDia(semMarcadores(barrasCnbc(lista, idx, false)));
        barras = sessoes.slice(periodo === '1D' ? -1 : -5).flatMap((g) => g.barras);
      } else {
        barras = umPorDia(barrasCnbc(lista, idx, true));
      }
      if (!barras.length) throw new Error('CNBC ' + idx.cnbc + ' ' + grafico + ': sem preços');
      const pontos = barras.map(paraPonto);
      // se o gráfico não cobre o período, tenta o próximo; o último vale como vier
      if (!cfg.intradiario && i < cfg.cnbc.length - 1) conferirCobertura(pontos, periodo, 'CNBC ' + idx.cnbc + ' ' + grafico);
      return { pontos, fonte: 'CNBC' };
    } catch (e) {
      erros.push(msg(e));
    }
  }
  throw new Error(erros.join(' / '));
}

/* ---------- serviços (linguagem do app) ---------- */
function buscarSessao(idx) {
  return comCache('sessao:' + idx.id, UM_MINUTO, async () => {
    const erros = [];
    try { return sessaoDoYahoo(await yahooGrafico(idx.yahoo, '1d', '5m'), idx); } catch (e) { erros.push(msg(e)); }
    if (idx.cnbc) {
      try {
        const s = sessaoDaCnbc(await cnbcGrafico(idx.cnbc, '1D'), idx);
        // o 1D às vezes só tem uma sessão (ex.: depois de feriado): o fechamento anterior sai do 5D
        if (s.fechamentoAnterior == null) {
          try { s.fechamentoAnterior = fechamentoAntesDe(barrasCnbc(await cnbcGrafico(idx.cnbc, '5D'), idx, false), s.data); } catch { /* fica sem a variação do dia */ }
        }
        return s;
      } catch (e) { erros.push(msg(e)); }
    }
    throw new ErroDeFonte(idx, erros);
  });
}

function buscarSerie(idx, periodo) {
  return comCache('serie:' + idx.id + ':' + periodo, CONFIG_PERIODO[periodo].validade, async () => {
    const erros = [];
    try { return await serieDoYahoo(idx, periodo); } catch (e) { erros.push(msg(e)); }
    try { return await serieDaCnbc(idx, periodo); } catch (e) { erros.push(msg(e)); }
    throw new ErroDeFonte(idx, erros);
  });
}

// Põe o último preço da sessão no fim da série (a série fica em cache por mais tempo que a sessão).
function juntarSessao(pontos, sessao, intradiario) {
  const lista = pontos.slice();
  const ult = lista[lista.length - 1];
  if (!sessao || !sessao.valor || !sessao.data) return lista;
  if (!ult) return [{ t: sessao.t, data: sessao.data, valor: sessao.valor }];
  if (intradiario) {
    if (sessao.t > ult.t && sessao.data >= ult.data) lista.push({ t: sessao.t, data: sessao.data, valor: sessao.valor });
  } else if (sessao.data > ult.data) {
    lista.push({ t: sessao.t || ult.t, data: sessao.data, valor: sessao.valor });
  } else if (sessao.data === ult.data) {
    lista[lista.length - 1] = { t: ult.t, data: ult.data, valor: sessao.valor };
  }
  return lista;
}

async function extremos52(idx, sessao) {
  const serie = await buscarSerie(idx, '1A');
  const fim = sessao.data || serie.pontos[serie.pontos.length - 1].data;
  const ini = menosMeses(fim, 12);
  const valores = serie.pontos.filter((p) => p.data >= ini).map((p) => p.valor)
    .concat([sessao.valor, sessao.resumo.alta, sessao.resumo.baixa]);
  return { alta52: maximo(valores), baixa52: minimo(valores) };
}

/* Gráfico de um índice num período: contrato de GET /api/indices?id=&periodo= */
export async function buscarCotacaoDoIndice(id, periodo) {
  const idx = indicePorId(id);
  const cfg = CONFIG_PERIODO[periodo];
  if (!cfg) throw new Error('Período inválido: "' + periodo + '". Use ' + PERIODOS.join(', ') + '.');
  const [sessao, serie] = await Promise.all([
    buscarSessao(idx),
    periodo === '1D' ? null : buscarSerie(idx, periodo),
  ]);
  let pontos = periodo === '1D' ? sessao.pontos : juntarSessao(serie.pontos, sessao, cfg.intradiario);
  if (!cfg.intradiario && pontos.length) {
    const ini = inicioDoPeriodo(periodo, pontos[pontos.length - 1].data);
    if (ini) {
      const recorte = pontos.filter((p) => p.data >= ini);
      pontos = recorte.length >= 2 ? recorte : pontos.slice(-2);
    }
  }
  const resumo = Object.assign({}, sessao.resumo);
  if (resumo.alta52 == null || resumo.baixa52 == null) {
    try { Object.assign(resumo, await extremos52(idx, sessao)); } catch (e) { console.error('índices: 52 semanas de ' + idx.id, msg(e)); }
  }
  return {
    id: idx.id,
    nome: idx.nome,
    moeda: sessao.moeda || idx.moeda || null,
    periodo,
    valor: sessao.valor,
    horario: sessao.horario,
    pregaoAberto: Boolean(sessao.pregaoAberto),
    fechamentoAnterior: sessao.fechamentoAnterior,
    intradiario: Boolean(cfg.intradiario),
    pontos: ordenar(pontos.filter((p) => p.valor > 0)).map(paraPonto),
    resumo,
    fonte: periodo === '1D' ? sessao.fonte : serie.fonte,
  };
}

/* Último valor e variação do dia de todos os índices: contrato de GET /api/indices?lista=resumo */
export function buscarResumoDosIndices() {
  return comCache('resumo', UM_MINUTO, async () => {
    let doSpark = {};
    try { doSpark = await yahooSpark(INDICES.map((i) => i.yahoo)); } catch (e) { console.error('índices: spark', msg(e)); }
    const itens = {};
    const falhas = {};
    const fontes = new Set();
    await Promise.all(INDICES.map(async (idx) => {
      let s = null;
      if (doSpark[idx.yahoo]) {
        try { s = sessaoDoYahoo(doSpark[idx.yahoo], idx); } catch (e) { console.error('índices: spark ' + idx.id, msg(e)); }
      }
      if (!s) {
        try { s = await buscarSessao(idx); } catch (e) {
          if (e && e.detalhes) console.error('índices: ' + idx.id, e.detalhes);
          falhas[idx.id] = msg(e);
          return;
        }
      }
      const variacaoDia = s.fechamentoAnterior ? arred(s.valor - s.fechamentoAnterior) : null;
      itens[idx.id] = {
        id: idx.id,
        nome: idx.nome,
        moeda: s.moeda || idx.moeda || null,
        valor: s.valor,
        variacaoDia,
        variacaoDiaPct: variacaoDia != null ? arred((variacaoDia / s.fechamentoAnterior) * 100) : null,
        horario: s.horario,
        pregaoAberto: Boolean(s.pregaoAberto),
      };
      fontes.add(s.fonte);
    }));
    return {
      atualizadoEm: new Date().toISOString(),
      indices: INDICES.filter((i) => itens[i.id]).map((i) => itens[i.id]),
      falhas,
      fonte: [...fontes].join(' e ') || null,
    };
  });
}

/* Fechamentos diários para o histórico do app (usado por api/mercado.js).
   Devolve { dados: { 'AAAA-MM-DD': valor }, moeda, fonte, pregaoAberto, hojeBolsa }.
   Com o pregão aberto, a barra de hojeBolsa é parcial: quem grava decide se guarda. */
export async function buscarHistoricoDiario(id, dias = 2200) {
  const idx = indicePorId(id);
  const n = Math.max(2, Math.floor(Number(dias) || 2200));
  const [range, meses] = n <= 20 ? ['1mo', 1] : n <= 120 ? ['6mo', 6] : n <= 250 ? ['1y', 12] : ['5y', 60];
  const [sessao, base] = await Promise.all([
    buscarSessao(idx).catch((e) => { console.error('índices: sessão de ' + idx.id, (e && e.detalhes) || msg(e)); return null; }),
    comCache('historico:' + idx.id + ':' + range, QUINZE_MINUTOS, async () => {
      const erros = [];
      try {
        const res = await yahooGrafico(idx.yahoo, range, '1d');
        const pontos = umPorDia(barrasYahoo(res, idx));
        if (!pontos.length) throw new Error('Yahoo ' + idx.yahoo + ': vazio');
        const fim = pontos[pontos.length - 1].data;
        if (pontos.length < 2 || pontos[0].data > maisDias(menosMeses(fim, meses), 20)) throw new Error('Yahoo ' + idx.yahoo + ': histórico incompleto');
        return { pontos: pontos.map(paraPonto), moeda: res.meta.currency || idx.moeda || null, fonte: 'Yahoo Finance' };
      } catch (e) { erros.push(msg(e)); }
      try {
        if (!idx.cnbc) throw new Error('CNBC: sem símbolo para ' + idx.nome);
        // na CNBC, 1M traz ~1 ano de barras diárias e 6M ~3 anos, mas com um dia de atraso (5Y já é semanal)
        const listas = await Promise.allSettled((n <= 240 ? ['1M'] : ['6M', '1M']).map((g) => cnbcGrafico(idx.cnbc, g)));
        const ok = listas.filter((r) => r.status === 'fulfilled');
        if (!ok.length) throw listas[0].reason;
        const pontos = umPorDia(ok.flatMap((r) => barrasCnbc(r.value, idx, true)));
        if (!pontos.length) throw new Error('CNBC ' + idx.cnbc + ': sem preços');
        return { pontos: pontos.map(paraPonto), moeda: idx.moeda || null, fonte: 'CNBC' };
      } catch (e) { erros.push(msg(e)); }
      throw new ErroDeFonte(idx, erros);
    }),
  ]);
  const pontos = juntarSessao(base.pontos, sessao, false).slice(-n);
  const hojeBolsa = dataLocal(Date.now(), idx.fuso);
  const ultimaData = pontos.length ? pontos[pontos.length - 1].data : null;
  return {
    dados: Object.fromEntries(pontos.map((p) => [p.data, p.valor])),
    moeda: base.moeda,
    fonte: base.fonte,
    // sem a sessão não dá para saber se o pregão acabou: na dúvida, trata a barra de hoje como parcial
    pregaoAberto: sessao ? Boolean(sessao.pregaoAberto) : ultimaData === hojeBolsa,
    hojeBolsa,
  };
}
