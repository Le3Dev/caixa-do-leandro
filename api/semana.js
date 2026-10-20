import crypto from 'node:crypto';
import { json, falha, lerEstado } from './_lib.js';
import { lerPush, enviarTodos, marcarEnviado } from './_push.js';

// GET /api/semana → chamado pelo cron na sexta à tarde.
// Manda um resumo da semana: quanto o patrimônio mudou, quanto foi rendimento e quanto você gastou.
// O app guarda uma "foto" de cada dia (fotos/main) com o patrimônio e o rendimento acumulado;
// aqui comparamos a foto mais recente com a de 7 dias antes.
// Teste: /api/semana?teste=<código> (o mesmo do aviso de pagamento) manda agora.

const TESTE_HASH = '8da85d7bd5bcff5e3820090ec5998a99747c78fb5cbc230c15fdd157d6eff73c';
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const R = (v) => brl.format(Number(v) || 0);
const RS = (v) => (v >= 0 ? '+' : '−') + brl.format(Math.abs(Number(v) || 0));
const hojeBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const menosDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const curta = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
const CATS = { uber: 'Uber', ifood: 'iFood', restaurante: 'Restaurante', mercado: 'Mercado', lazer: 'Lazer', outro: 'Outro' };

export function montarResumo(cols, hoje) {
  const inicio = menosDias(hoje, 7);
  const dias = (cols.fotos && cols.fotos.main && cols.fotos.main.dias) || {};
  const ks = Object.keys(dias).sort();
  const ate = [...ks].reverse().find((k) => k <= hoje);
  const de = [...ks].reverse().find((k) => k <= inicio) || ks[0];
  const partes = [];
  let titulo = 'Resumo da semana';
  if (ate && de && ate > de) {
    const f1 = dias[ate], f0 = dias[de];
    const mudou = f1.t - f0.t;
    const rend = f1.g - f0.g;
    partes.push('Patrimônio ' + RS(mudou) + ' (agora ' + R(f1.t) + ').');
    partes.push('Investimentos renderam ' + RS(rend) + '.');
    if (ate < hoje) titulo += ' (até ' + curta(ate) + ')';
  }
  // gastos lançados nos últimos 7 dias
  const gastos = Object.values(cols.movimentos || {}).filter((m) => m && m.tipo === 'gasto' && m.data > inicio && m.data <= hoje);
  const total = gastos.reduce((s, m) => s + (Number(m.valor) || 0), 0);
  if (total > 0) {
    const porCat = {};
    gastos.forEach((m) => { const c = m.categoria || 'outro'; porCat[c] = (porCat[c] || 0) + (Number(m.valor) || 0); });
    const [cat, v] = Object.entries(porCat).sort((a, b) => b[1] - a[1])[0];
    partes.push('Você gastou ' + R(total) + (Object.keys(porCat).length > 1 ? ', mais em ' + (CATS[cat] || 'Outro') + ' (' + R(v) + ')' : '') + '.');
  } else {
    partes.push('Nenhum gasto lançado na semana.');
  }
  partes.push('Toque para baixar o relatório em PDF.');
  return { title: titulo, body: partes.join(' '), tag: 'semana-' + hoje, url: '/?aba=patrimonio&relatorio=semana' };
}

export async function GET(request) {
  try {
    const codigo = new URL(request.url).searchParams.get('teste');
    const teste = codigo !== null;
    if (teste) {
      if (crypto.createHash('sha256').update(String(codigo)).digest('hex') !== TESTE_HASH) return json({ erro: 'não autorizado' }, 401);
    } else {
      const segredo = process.env.CRON_SECRET;
      if (segredo && request.headers.get('authorization') !== `Bearer ${segredo}`) return json({ erro: 'não autorizado' }, 401);
    }
    const hoje = hojeBR();
    const chave = 'semana:' + hoje;
    if (!teste) {
      const { enviados } = await lerPush();
      if (enviados[chave]) return json({ hoje, motivo: 'já enviado' });
    }
    const { estado } = await lerEstado();
    const aviso = montarResumo(estado.cols || {}, hoje);
    if (teste) { aviso.title = 'Teste · ' + aviso.title; aviso.tag = 'teste-semana'; }
    const r = await enviarTodos(aviso);
    if (!teste && r.enviados > 0) await marcarEnviado(chave);
    return json({ hoje, aviso, ...r });
  } catch (e) {
    return falha(e);
  }
}
