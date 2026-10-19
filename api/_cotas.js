// Cotas diárias de fundos, do informe diário da CVM (dados abertos).
// Um arquivo por mês com todos os fundos; o app guarda só as cotas dos fundos que você tem.
import { unzipSync, strFromU8 } from 'fflate';

const soDigitos = (s) => String(s || '').replace(/\D/g, '');
const mesesAte = (hoje, n) => {
  const out = [];
  let [y, m] = hoje.slice(0, 7).split('-').map(Number);
  for (let i = 0; i < n; i++) { out.push(y + String(m).padStart(2, '0')); m--; if (!m) { m = 12; y--; } }
  return out;
};

async function lerMes(aaaamm, alvos) {
  const url = `https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/inf_diario_fi_${aaaamm}.zip`;
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error('CVM ' + aaaamm + ': ' + r.status);
  const zip = unzipSync(new Uint8Array(await r.arrayBuffer()));
  const nome = Object.keys(zip).find((k) => k.endsWith('.csv'));
  if (!nome) return {};
  const texto = strFromU8(zip[nome], true);
  const fim1 = texto.indexOf('\n');
  const cab = texto.slice(0, fim1).trim().split(';');
  const iC = cab.findIndex((c) => c === 'CNPJ_FUNDO_CLASSE' || c === 'CNPJ_FUNDO');
  const iD = cab.indexOf('DT_COMPTC');
  const iQ = cab.indexOf('VL_QUOTA');
  const iS = cab.indexOf('ID_SUBCLASSE');
  const achados = {};
  // procura só as linhas dos fundos que interessam, sem quebrar o arquivo inteiro
  for (const cnpj of alvos) {
    const fmt = cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
    let pos = texto.indexOf(fmt);
    while (pos >= 0) {
      const ini = texto.lastIndexOf('\n', pos) + 1;
      const fim = texto.indexOf('\n', pos);
      const col = texto.slice(ini, fim < 0 ? undefined : fim).trim().split(';');
      if (soDigitos(col[iC]) === cnpj && (iS < 0 || !col[iS])) {
        const q = Number(col[iQ]);
        if (q > 0 && /^\d{4}-\d{2}-\d{2}$/.test(col[iD])) (achados[cnpj] = achados[cnpj] || {})[col[iD]] = q;
      }
      pos = fim < 0 ? -1 : texto.indexOf(fmt, fim);
    }
  }
  return achados;
}

/* Cotas dos últimos `meses` meses para os CNPJs pedidos: { cnpj: { 'AAAA-MM-DD': cota } } */
export async function buscarCotas(cnpjs, hoje, meses = 2) {
  const alvos = [...new Set(cnpjs.map(soDigitos).filter((c) => c.length === 14))];
  const out = {};
  if (!alvos.length) return out;
  for (const mes of mesesAte(hoje, meses)) {
    const r = await lerMes(mes, alvos);
    for (const [c, d] of Object.entries(r)) out[c] = Object.assign(out[c] || {}, d);
  }
  return out;
}
export { soDigitos };
