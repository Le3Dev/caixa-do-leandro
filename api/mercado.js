import { json, falha, autorizado, alterar, lerEstado, guardarCopia, ErroPedido } from './_lib.js';

// Dólar PTAX de venda, CDI anualizado, Selic meta e IPCA de 12 meses, direto do Banco Central.
// GET  /api/mercado → chamado pelo cron da Vercel todo dia útil (Authorization: Bearer CRON_SECRET)
// POST /api/mercado → botão "Atualizar agora" no app (precisa estar logado)

const SERIES = { dolar: 1, cdi: 4389, selic: 432, ipca: 13522, ipcaMes: 433 };

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

async function atualizar() {
  const [dolar, cdi, selic, ipca, ipcaMes] = await Promise.allSettled([
    serie(SERIES.dolar, 10), serie(SERIES.cdi, 10), serie(SERIES.selic, 1), serie(SERIES.ipca, 1), serie(SERIES.ipcaMes, 36),
  ]);
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
  });
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
