// Destaques da semana do Ibovespa: as maiores quedas e as maiores altas da semana, só entre as ações da carteira do índice.
// Carteira teórica do dia: B3 (GetPortfolioDay). Cotações diárias: Yahoo Finance (spark, no máximo 20 símbolos por chamada).
// A semana começa na segunda-feira (fuso de Brasília) e compara o preço atual com o último fechamento antes dela.

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// o Yahoo responde 429 para user-agent de navegador completo sem cookie; com o genérico responde normalmente
const UA_YAHOO = 'Mozilla/5.0';
const FONTE = 'B3 (carteira do Ibovespa) e Yahoo Finance';
const URL_CARTEIRA = 'https://sistemaswebb3-listados.b3.com.br/indexProxy/indexCall/GetPortfolioDay/';
const SIMBOLOS_POR_LOTE = 20;   // o spark recusa mais de 20 símbolos por chamada
const LOTES_SIMULTANEOS = 2;    // mais que isso o Yahoo devolve 429
const VALIDADE_CARTEIRA = 24 * 3600e3;
const VALIDADE_DESTAQUES = 60e3;
const UM_DIA = 864e5;
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const arred = (v, casas) => { const f = 10 ** casas; return Math.round(v * f) / f; };
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* ---------- datas (sempre 'AAAA-MM-DD') ---------- */
const hojeBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const somarDias = (dia, n) => new Date(Date.parse(dia + 'T00:00:00Z') + n * UM_DIA).toISOString().slice(0, 10);
const diaDaSemana = (dia) => new Date(dia + 'T00:00:00Z').getUTCDay(); // 0 = domingo … 6 = sábado
// data local da bolsa a partir do horário Unix (segundos) e do deslocamento do fuso (segundos)
const dataDaBolsa = (segundos, gmtoffset) => new Date((Number(segundos) + (Number(gmtoffset) || 0)) * 1000).toISOString().slice(0, 10);

/* Segunda-feira igual ou anterior ao dia; sábado e domingo caem na segunda da semana que acabou de terminar. */
export const segundaDaSemana = (dia) => somarDias(dia, -((diaDaSemana(dia) + 6) % 7));

/* ---------- carteira do Ibovespa (B3) ---------- */
const numeroBR = (s) => {
  const t = String(s == null ? '' : s).trim();
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

/* Converte a resposta do GetPortfolioDay em [{ codigo, nome, participacao }] (participação em %). */
export function lerCarteiraB3(json) {
  const linhas = json && Array.isArray(json.results) ? json.results : [];
  const out = [];
  const vistos = new Set();
  for (const l of linhas) {
    const codigo = String((l && l.cod) || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}\d{1,2}$/.test(codigo) || vistos.has(codigo)) continue;
    vistos.add(codigo);
    const part = numeroBR(l.part);
    out.push({
      codigo,
      nome: String(l.asset || codigo).trim().replace(/\s+/g, ' '),
      participacao: Number.isFinite(part) ? arred(part, 3) : null,
    });
  }
  return out;
}

let cacheCarteira = null; // { em, acoes }

async function buscarCarteiraIbovespa() {
  if (cacheCarteira && Date.now() - cacheCarteira.em < VALIDADE_CARTEIRA) return cacheCarteira.acoes;
  try {
    const porCodigo = new Map();
    let pagina = 1;
    let paginas = 1;
    do {
      const consulta = Buffer.from(JSON.stringify({ language: 'pt-br', pageNumber: pagina, pageSize: 120, index: 'IBOV', segment: '1' })).toString('base64');
      const r = await fetch(URL_CARTEIRA + consulta, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('B3: ' + r.status);
      const j = await r.json();
      lerCarteiraB3(j).forEach((a) => { if (!porCodigo.has(a.codigo)) porCodigo.set(a.codigo, a); });
      paginas = Math.min(5, Number(j && j.page && j.page.totalPages) || 1);
      pagina++;
    } while (pagina <= paginas);
    if (!porCodigo.size) throw new Error('B3: carteira vazia');
    cacheCarteira = { em: Date.now(), acoes: [...porCodigo.values()] };
    return cacheCarteira.acoes;
  } catch (e) {
    console.error('carteira do Ibovespa', String(e && e.message));
    if (cacheCarteira) return cacheCarteira.acoes; // melhor a carteira de ontem do que nada
    throw new Error('Não consegui buscar a carteira do Ibovespa na B3.');
  }
}

/* ---------- cotações (Yahoo spark) ---------- */

/* Converte a resposta do spark em { CODIGO: { barras: [{ data, fechamento }], preco, dataPreco } } (sem o sufixo .SA). */
export function lerSparkYahoo(json) {
  const itens = json && json.spark && Array.isArray(json.spark.result) ? json.spark.result : [];
  const out = {};
  for (const item of itens) {
    const codigo = String((item && item.symbol) || '').trim().toUpperCase().replace(/\.SA$/, '');
    const res = item && Array.isArray(item.response) ? item.response[0] : null;
    if (!codigo || !res) continue;
    const meta = res.meta || {};
    const off = Number(meta.gmtoffset) || 0;
    const tempos = Array.isArray(res.timestamp) ? res.timestamp : [];
    const fech = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
    const porData = {};
    tempos.forEach((t, i) => {
      const v = Number(fech[i]); // null vira 0 e é descartado
      if (Number.isFinite(Number(t)) && Number.isFinite(v) && v > 0) porData[dataDaBolsa(t, off)] = v;
    });
    const preco = Number(meta.regularMarketPrice);
    const tempo = Number(meta.regularMarketTime);
    out[codigo] = {
      barras: Object.keys(porData).sort().map((data) => ({ data, fechamento: porData[data] })),
      preco: Number.isFinite(preco) && preco > 0 ? preco : null,
      dataPreco: Number.isFinite(tempo) && tempo > 0 ? dataDaBolsa(tempo, off) : null,
    };
  }
  return out;
}

async function buscarLoteYahoo(simbolos) {
  const caminho = '/v7/finance/spark?symbols=' + simbolos.map(encodeURIComponent).join(',') + '&range=1mo&interval=1d';
  const erros = [];
  // query1, depois query2; se os dois recusarem, uma última tentativa depois de uma pausa (429 costuma passar)
  for (const [host, pausa] of [['query1', 0], ['query2', 0], ['query2', 1500]]) {
    try {
      if (pausa) await esperar(pausa);
      const r = await fetch('https://' + host + '.finance.yahoo.com' + caminho, { headers: { 'user-agent': UA_YAHOO, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(host + ': ' + r.status);
      return await r.json();
    } catch (e) { erros.push(String(e && e.message)); }
  }
  throw new Error('Yahoo ' + simbolos[0] + '…: ' + erros.join(' / '));
}

// roda `tarefa` para cada item com no máximo `simultaneos` ao mesmo tempo
async function emParalelo(itens, simultaneos, tarefa) {
  let proximo = 0;
  const trabalhador = async () => { while (proximo < itens.length) await tarefa(itens[proximo++]); };
  await Promise.all(Array.from({ length: Math.min(simultaneos, itens.length) }, trabalhador));
}

async function buscarCotacoesYahoo(codigos) {
  const pedidos = new Set(codigos);
  const lotes = [];
  for (let i = 0; i < codigos.length; i += SIMBOLOS_POR_LOTE) lotes.push(codigos.slice(i, i + SIMBOLOS_POR_LOTE));
  const cotacoes = {};
  const erros = [];
  await emParalelo(lotes, LOTES_SIMULTANEOS, async (lote) => {
    try {
      const lidas = lerSparkYahoo(await buscarLoteYahoo(lote.map((c) => c + '.SA')));
      for (const [codigo, c] of Object.entries(lidas)) if (pedidos.has(codigo)) cotacoes[codigo] = c;
    } catch (e) { erros.push(String(e && e.message)); }
  });
  if (erros.length) console.error('cotações do Ibovespa', erros);
  if (lotes.length && erros.length === lotes.length) throw new Error('Não consegui buscar as cotações das ações do Ibovespa no Yahoo Finance.');
  return cotacoes;
}

/* ---------- cálculo (puro) ---------- */

// último fechamento com data anterior ao dia
const ultimaAntes = (barras, dia) => {
  for (let i = barras.length - 1; i >= 0; i--) if (barras[i].data < dia) return barras[i];
  return null;
};

/* Variação da semana de cada ação. Função pura (não acessa rede nem relógio).
   cotacoes: { CODIGO: { barras: [{ data: 'AAAA-MM-DD', fechamento }], preco?, dataPreco? } }
     preco = preço atual (se faltar, vale o último fechamento); dataPreco = dia desse preço.
   hoje: 'AAAA-MM-DD' no fuso de Brasília.
   Devolve { semana: { de, ate, base }, fechada, variacoes: { CODIGO: { preco, data, fechamentoBase, dataBase, variacaoSemana, variacaoSemanaPct } }, semDados } */
export function calcularVariacaoDaSemana(cotacoes, hoje) {
  if (!DIA_ISO.test(String(hoje || ''))) throw new Error('Data de hoje inválida: ' + hoje);
  const segundaAtual = segundaDaSemana(hoje);
  const dds = diaDaSemana(hoje);

  // normaliza: barras válidas em ordem e o último preço conhecido (com a data dele)
  const series = {};
  for (const [codigo, c] of Object.entries(cotacoes || {})) {
    const porData = {};
    (c && Array.isArray(c.barras) ? c.barras : []).forEach((b) => {
      const v = Number(b && b.fechamento);
      if (b && DIA_ISO.test(String(b.data)) && b.data <= hoje && Number.isFinite(v) && v > 0) porData[b.data] = v;
    });
    const barras = Object.keys(porData).sort().map((data) => ({ data, fechamento: porData[data] }));
    const ultima = barras[barras.length - 1] || null;
    const precoMeta = Number(c && c.preco) > 0 ? Number(c.preco) : null;
    const dataMeta = precoMeta && DIA_ISO.test(String(c.dataPreco || '')) && c.dataPreco <= hoje ? c.dataPreco : null;
    const data = [dataMeta, ultima && ultima.data].filter(Boolean).sort().pop() || null;
    series[codigo] = { barras, preco: precoMeta || (ultima && ultima.fechamento) || null, data };
  }

  // nenhuma ação negociou nesta semana (segunda antes da abertura, feriado): mostra a semana anterior, já fechada
  const recuar = !Object.values(series).some((s) => s.data && s.data >= segundaAtual);
  const de = recuar ? somarDias(segundaAtual, -7) : segundaAtual;

  const variacoes = {};
  const semDados = [];
  const contagemBase = {};
  let ate = null;
  for (const [codigo, s] of Object.entries(series)) {
    let preco = s.preco;
    let data = s.data;
    if (recuar) {
      const b = ultimaAntes(s.barras, segundaAtual);
      preco = b ? b.fechamento : null;
      data = b ? b.data : null;
    }
    const base = ultimaAntes(s.barras, de);
    if (!(preco > 0) || !data || !base) { semDados.push(codigo); continue; }
    const variacao = preco - base.fechamento;
    variacoes[codigo] = {
      preco: arred(preco, 2),
      data,
      fechamentoBase: arred(base.fechamento, 2),
      dataBase: base.data,
      variacaoSemana: arred(variacao, 2),
      variacaoSemanaPct: arred((variacao / base.fechamento) * 100, 2),
    };
    contagemBase[base.data] = (contagemBase[base.data] || 0) + 1;
    if (!ate || data > ate) ate = data;
  }

  // data base mais comum entre as ações (empate: a mais recente)
  const base = Object.entries(contagemBase).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)).map((e) => e[0])[0] || null;
  return {
    semana: { de, ate, base },
    fechada: recuar || dds === 0 || dds === 6,
    variacoes,
    semDados: semDados.sort(),
  };
}

/* Junta a carteira com as cotações e monta os destaques (sem atualizadoEm/fonte). Função pura.
   carteira: [{ codigo, nome, participacao }]; cotacoes: como em calcularVariacaoDaSemana; limite: quantas em cada lista. */
export function montarDestaques({ carteira, cotacoes, hoje, limite = 10 }) {
  const lista = Array.isArray(carteira) ? carteira : [];
  const daCarteira = {};
  for (const a of lista) if (cotacoes && cotacoes[a.codigo]) daCarteira[a.codigo] = cotacoes[a.codigo];
  const calc = calcularVariacaoDaSemana(daCarteira, hoje);

  const acoes = [];
  const semDados = [];
  for (const a of lista) {
    const v = calc.variacoes[a.codigo];
    if (!v) { semDados.push(a.codigo); continue; }
    acoes.push({ codigo: a.codigo, nome: a.nome, preco: v.preco, variacaoSemana: v.variacaoSemana, variacaoSemanaPct: v.variacaoSemanaPct, participacao: a.participacao });
  }
  const n = Number(limite);
  const corte = (arr) => (Number.isFinite(n) ? arr.slice(0, Math.max(0, Math.floor(n))) : arr);
  const porCodigo = (a, b) => (a.codigo < b.codigo ? -1 : a.codigo > b.codigo ? 1 : 0);
  return {
    semana: calc.semana,
    fechada: calc.fechada,
    quedas: corte(acoes.filter((a) => a.variacaoSemanaPct < 0).sort((a, b) => a.variacaoSemanaPct - b.variacaoSemanaPct || porCodigo(a, b))),
    altas: corte(acoes.filter((a) => a.variacaoSemanaPct > 0).sort((a, b) => b.variacaoSemanaPct - a.variacaoSemanaPct || porCodigo(a, b))),
    total: acoes.length,
    semDados: [...new Set(semDados)].sort(),
  };
}

/* ---------- função pública ---------- */

let cacheDestaques = null; // { em, dados } com as listas completas; o limite é aplicado na saída
let emAndamento = null;    // chamadas simultâneas esperam a mesma busca

async function atualizarDestaques() {
  const carteira = await buscarCarteiraIbovespa();
  const cotacoes = await buscarCotacoesYahoo(carteira.map((a) => a.codigo));
  const r = montarDestaques({ carteira, cotacoes, hoje: hojeBR(), limite: Infinity });
  if (!r.total) throw new Error('Nenhuma ação do Ibovespa tem cotação suficiente para calcular a variação da semana.');
  return { em: Date.now(), dados: Object.assign(r, { atualizadoEm: new Date().toISOString(), fonte: FONTE }) };
}

/* As `limite` maiores quedas e altas da semana entre as ações do Ibovespa (resultado guardado por 60 s). */
export async function buscarDestaquesDaSemana({ limite = 10 } = {}) {
  const pedido = Number(limite);
  const n = Number.isFinite(pedido) && pedido >= 1 ? Math.min(100, Math.floor(pedido)) : 10;
  if (!cacheDestaques || Date.now() - cacheDestaques.em >= VALIDADE_DESTAQUES) {
    if (!emAndamento) {
      emAndamento = atualizarDestaques()
        .then((c) => { cacheDestaques = c; return c; })
        .finally(() => { emAndamento = null; });
    }
    await emAndamento;
  }
  const d = cacheDestaques.dados;
  return {
    semana: { ...d.semana },
    fechada: d.fechada,
    atualizadoEm: d.atualizadoEm,
    quedas: d.quedas.slice(0, n).map((a) => ({ ...a })),
    altas: d.altas.slice(0, n).map((a) => ({ ...a })),
    total: d.total,
    semDados: [...d.semDados],
    fonte: d.fonte,
  };
}
