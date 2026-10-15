import crypto from 'node:crypto';
import { json, falha, lerEstado } from './_lib.js';
import { lerPush, enviarTodos, marcarEnviado } from './_push.js';

// GET /api/avisos → chamado pelo cron todo dia útil de manhã.
// No dia em que um pagamento deve cair (dia 15 e último dia útil do mês, como na aba Mês),
// manda uma notificação, se ele ainda não foi lançado. Cada aviso sai uma vez só.

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const R = (v) => brl.format(Number(v) || 0);
const isoDe = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const hojeBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function dataPrevista(mes, tipo) {
  const [y, m] = mes.split('-').map(Number);
  const d = tipo === 'adiantamento' ? new Date(y, m - 1, 15) : new Date(y, m, 0);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return isoDe(d);
}

/* A mesma divisão da aba Mês. */
function divisao(cfg, receb, mes, tipo) {
  const bruto = Number(cfg.salarioBruto) || 0;
  const pct = Number(cfg.adiantamentoPct) || 0;
  const desc = Number(cfg.descontosFixos) || 0;
  const meta = Number(cfg.paraMim) || 0;
  const modo = cfg.modo || 'proporcional';
  const liquido = r2(bruto - desc);
  const adiant = r2(bruto * pct / 100);
  const final = r2(liquido - adiant);
  const valor = tipo === 'adiantamento' ? adiant : final;
  const ja = receb.filter((r) => r.mes === mes && r.tipo !== 'extra').reduce((s, r) => s + (Number(r.paraMim) || 0), 0);
  const restante = Math.max(0, r2(meta - ja));
  let mim;
  if (modo === 'primeiro' || tipo === 'final' || !(liquido > 0)) mim = Math.min(valor, restante);
  else if (modo === 'metade') mim = Math.min(valor, restante, meta / 2);
  else mim = Math.min(valor, restante, meta * valor / liquido);
  mim = r2(Math.max(0, mim));
  return { valor, mim, investir: r2(Math.max(0, valor - mim)) };
}

// Teste: /api/avisos?teste=<código> manda agora, com "Teste" no título, o aviso do próximo pagamento.
// Só o hash do código está aqui; sem o código não dá para disparar.
const TESTE_HASH = '8da85d7bd5bcff5e3820090ec5998a99747c78fb5cbc230c15fdd157d6eff73c';

function montarAviso(cfg, receb, mes, tipo) {
  const d = divisao(cfg, receb, mes, tipo);
  const tag = mes + ':' + tipo;
  return tipo === 'adiantamento'
    ? { title: 'Dia de adiantamento', body: 'Deve cair ' + R(d.valor) + ' hoje. Separe ' + R(d.mim) + ' para você e invista ' + R(d.investir) + '.', tag, url: '/?aba=mes' }
    : { title: 'Dia de salário', body: 'Deve cair cerca de ' + R(d.valor) + ' hoje. ' + R(d.mim) + ' para você e ' + R(d.investir) + ' para investir.', tag, url: '/?aba=mes' };
}

async function teste(codigo) {
  const ok = crypto.createHash('sha256').update(String(codigo)).digest('hex') === TESTE_HASH;
  if (!ok) return json({ erro: 'não autorizado' }, 401);
  const hoje = hojeBR();
  const { estado } = await lerEstado();
  const cols = estado.cols || {};
  const cfg = cols.config && cols.config.main;
  if (!cfg) return json({ erro: 'sem configuração' }, 400);
  const receb = Object.values(cols.recebimentos || {});
  // o próximo pagamento que ainda não foi lançado
  let mes = hoje.slice(0, 7), achado = null;
  for (let i = 0; i < 3 && !achado; i++) {
    for (const tipo of ['adiantamento', 'final']) {
      const data = dataPrevista(mes, tipo);
      if (data >= hoje && !receb.some((r) => r.mes === mes && r.tipo === tipo)) { achado = { mes, tipo, data }; break; }
    }
    const [y, m] = mes.split('-').map(Number);
    mes = m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0');
  }
  if (!achado) return json({ erro: 'nenhum pagamento à frente' }, 400);
  const aviso = montarAviso(cfg, receb, achado.mes, achado.tipo);
  aviso.title = 'Teste · ' + aviso.title;
  aviso.body = 'Assim vai chegar em ' + achado.data.slice(8, 10) + '/' + achado.data.slice(5, 7) + ': ' + aviso.body;
  aviso.tag = 'teste';
  return json({ proximo: achado, ...(await enviarTodos(aviso)) });
}

export async function GET(request) {
  const codigo = new URL(request.url).searchParams.get('teste');
  if (codigo !== null) {
    try { return await teste(codigo); } catch (e) { return falha(e); }
  }
  const segredo = process.env.CRON_SECRET;
  if (segredo && request.headers.get('authorization') !== `Bearer ${segredo}`) return json({ erro: 'não autorizado' }, 401);
  try {
    const hoje = process.env.AVISOS_HOJE || hojeBR();
    const mes = hoje.slice(0, 7);
    const { estado } = await lerEstado();
    const cols = estado.cols || {};
    const cfg = cols.config && cols.config.main;
    if (!cfg) return json({ hoje, enviado: false, motivo: 'sem configuração' });
    const receb = Object.values(cols.recebimentos || {});
    const { enviados } = await lerPush();
    const feitos = [];
    for (const tipo of ['adiantamento', 'final']) {
      if (dataPrevista(mes, tipo) !== hoje) continue;
      const chaveAviso = mes + ':' + tipo;
      if (enviados[chaveAviso]) { feitos.push({ tipo, motivo: 'já avisado' }); continue; }
      if (receb.some((r) => r.mes === mes && r.tipo === tipo)) { feitos.push({ tipo, motivo: 'já lançado' }); continue; }
      const aviso = montarAviso(cfg, receb, mes, tipo);
      const r = await enviarTodos(aviso);
      if (r.enviados > 0) await marcarEnviado(chaveAviso);
      feitos.push({ tipo, ...r });
    }
    return json({ hoje, feitos });
  } catch (e) {
    return falha(e);
  }
}
