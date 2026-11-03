// Controle de gastos da aba Para mim: quanto do valor do mês que fica com você (config.main.paraMim)
// já foi gasto, e o aviso de 80% / 100%. Só cálculo, sem rede: quem envia é api/escrever.js.
// O mês é o mês calendário da data do gasto; "hoje" é a data de Brasília.

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const R = (v) => brl.format(Number(v) || 0);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const hojeBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/* Quanto já foi gasto no mês de `hoje` (AAAA-MM-DD) contra o valor do mês para você.
   faixa: 0 (abaixo de 80%), 80 (de 80% até o valor do mês) ou 100 (passou do valor do mês). */
export function situacaoDoMes(cols, hoje = hojeBR()) {
  const c = cols || {};
  const mes = String(hoje).slice(0, 7);
  const cfg = c.config && c.config.main;
  const meta = r2(Math.max(0, Number(cfg && cfg.paraMim) || 0));
  const gasto = r2(Object.values(c.movimentos || {})
    .filter((m) => m && m.tipo === 'gasto' && String(m.data || '').slice(0, 7) === mes)
    .reduce((s, m) => s + (Number(m.valor) || 0), 0));
  // em centavos, para 80% e 100% não errarem por arredondamento
  const gc = Math.round(gasto * 100), mc = Math.round(meta * 100);
  const faixa = mc > 0 ? (gc > mc ? 100 : gc * 10 >= mc * 8 ? 80 : 0) : 0;
  const [y, m, d] = String(hoje).split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    mes,
    meta,
    gasto,
    pct: mc > 0 ? r2(gasto / meta * 100) : 0,
    faixa,
    sobra: r2(meta - gasto),
    diasRestantes: Math.max(1, ultimoDia - d + 1),
  };
}

/* A notificação da faixa atual. Sem faixa (abaixo de 80% ou sem valor do mês), devolve null. */
export function avisoDeGastos(s) {
  if (!s || !(s.faixa >= 80)) return null;
  const nome = MESES[Number(s.mes.slice(5, 7)) - 1] || s.mes;
  const tag = 'gastos:' + s.mes + ':' + s.faixa;
  if (s.faixa >= 100) {
    return {
      title: 'Para mim: limite passou',
      body: 'Você gastou ' + R(s.gasto) + ' em ' + nome + ', ' + R(s.gasto - s.meta) + ' acima dos ' + R(s.meta) + '.',
      tag,
      url: '/?aba=mim',
    };
  }
  const dias = s.diasRestantes === 1 ? '1 dia' : s.diasRestantes + ' dias';
  return {
    title: 'Para mim: 80% usado',
    body: 'Você já gastou ' + R(s.gasto) + ' dos ' + R(s.meta) + ' de ' + nome + '. Sobram ' + R(s.sobra) + ' para ' + dias + '.',
    tag,
    url: '/?aba=mim',
  };
}

/* O que falta avisar, dado o que já foi enviado (enviados do push): { aviso, marcar: [chaves] } ou null.
   Cada faixa sai uma vez por mês. Se pulou direto para 100%, vai só o de 100% e o de 80% fica marcado também. */
export function avisoPendente(s, enviados) {
  const aviso = avisoDeGastos(s);
  if (!aviso) return null;
  const ja = enviados || {};
  if (ja[aviso.tag]) return null;
  const marcar = [aviso.tag];
  const k80 = 'gastos:' + s.mes + ':80';
  if (s.faixa >= 100 && !ja[k80]) marcar.push(k80);
  return { aviso, marcar };
}
