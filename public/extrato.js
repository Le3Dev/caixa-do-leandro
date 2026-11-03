/* Importação do extrato da conta do Itaú (PDF).
   O PDF é lido só no navegador, com o pdf.js (baixado do cdnjs na primeira vez que precisa): o arquivo nunca vai para o servidor.
   window.caixaExtrato = {
     ler(file)            -> { banco: 'itau', titular, periodo, conferido, aviso, lancamentos }
     abrirRevisao(opcoes) -> { importados } | null (cancelou)
     padraoDe(descricao)  -> chave do estabelecimento usada nas regras
   }
   O nome do titular fica só em memória: serve para reconhecer transferências entre as próprias contas e nunca é salvo. */
(() => {
  'use strict';

  /* pdf.js 3.11 (UMD, window.pdfjsLib): roda no Safari do iPhone sem precisar de módulos. Os dois arquivos são conferidos por hash (SRI). */
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const SRI_PDFJS = 'sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==';
  const SRI_WORKER = 'sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==';
  const NAO_RECONHECI = 'Não reconheci esse PDF como extrato da conta do Itaú.';
  const JANELA_DATA = 45;    // dias: a data colada na descrição precisa cair até isso antes do lançamento
  const JANELA_REPETIDO = 3; // dias: gasto já salvo com o mesmo valor até essa distância "parece já lançado"
  const MAX_PAGINAS = 200;
  const MAX_BYTES = 20 * 1024 * 1024;

  const CATEGORIAS = [['uber', 'Uber e 99'], ['ifood', 'iFood'], ['restaurante', 'Restaurante'], ['mercado', 'Mercado'],
    ['transporte', 'Transporte'], ['combustivel', 'Combustível'], ['farmacia', 'Farmácia'], ['compras', 'Compras'],
    ['assinaturas', 'Assinaturas'], ['viagem', 'Viagem'], ['lazer', 'Lazer'], ['outro', 'Outro']];

  /* Categoria pelo trecho do nome (só nomes de empresas). '^' no começo = o trecho precisa começar uma palavra. */
  const REGRAS_PADRAO = [
    ['uber', ['UBER', '99 TECNOLOG', '99APP']],
    ['ifood', ['IFOOD']],
    ['combustivel', ['POSTO']],
    ['transporte', ['TRANSP COLET', 'AUTOPARK', 'ESTACIONAMEN', 'PUCPR', 'RPASS']],
    ['farmacia', ['DROGARIA', 'FARMACIA', 'DROGASIL', '^RAIA']],
    ['compras', ['AMAZON', 'SHPP', 'SHOPEE', 'MERCADOLIVRE', 'MARKETP', 'MAGALU']],
    ['assinaturas', ['APPLE', 'NETFLIX', 'SPOTIFY', 'BYTEDANCE', 'GOOGLE', 'YOUTUBE', 'DISNEY', 'PRIME VIDEO', '^HBO']],
    ['viagem', ['AIRBNB', 'BOOKING', 'LATAM']],
    ['mercado', ['ANGELONI', 'SUPERMERC', 'HORTA', 'ATACAD', '^ASSAI', 'CARREFOUR']],
    ['restaurante', ['RESTAURANTE', '^RESTA ']],
  ].map(([cat, trechos]) => [cat, trechos.map((t) => {
    const inicio = t[0] === '^';
    const s = (inicio ? t.slice(1) : t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp((inicio ? '(?:^|[^A-Z0-9])' : '') + s);
  })]);

  const M = {
    salario: 'Salário (já entra pelo app)',
    aplicacao: 'Aplicação no Cofrinho',
    resgate: 'Resgate do Cofrinho',
    rendimento: 'Rendimento da aplicação automática',
    aplicAut: 'Aplicação automática da conta',
    propria: 'Transferência entre suas contas',
    devolvido: (d) => 'Devolvido em ' + d,
    pixRecebido: 'Pix recebido de outra pessoa: confira',
    pixEnviado: 'Pix para outra pessoa: confira',
    tedEnviada: 'TED enviada: confira para quem foi',
    tedRecebida: 'TED recebida: confira',
    prepago: 'Confira: pode ser cartão ou recarga',
    fatura: 'Pagamento de fatura: os gastos do cartão podem já estar lançados',
    devSemPar: 'Devolução sem a compra neste extrato: confira',
    devEnviada: 'Devolução enviada: confira',
    entrada: 'Entrada não reconhecida: confira',
    reconhecido: 'Reconhecido pelo nome',
    novo: 'Estabelecimento novo: escolha a categoria',
    regraImportar: 'Pela sua regra',
    regraIgnorar: 'Você pediu para ignorar este estabelecimento',
    regraRevisar: 'Sua regra: conferir antes de importar',
  };

  /* ---------- utilidades ---------- */
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const R = (v) => brl.format(Number(v) || 0);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const semAcento = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();
  const centavos = (v) => Math.round((Number(v) || 0) * 100);
  const ddmm = (iso) => { const p = String(iso).split('-'); return p[2] + '/' + p[1]; };
  const dataBR = (iso) => { const p = String(iso).split('-'); return p[2] + '/' + p[1] + '/' + p[0]; };
  const utc = (iso) => { const p = String(iso).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); };
  const diasEntre = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  function isoValida(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  const isoDeBR = (s) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s).trim()); return m ? isoValida(+m[3], +m[2], +m[1]) : null; };
  const nomeMes = (aaaamm) => {
    const [y, m] = aaaamm.split('-').map(Number);
    const s = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const MINUSCULAS = new Set(['a', 'o', 'e', 'da', 'de', 'do', 'das', 'dos', 'em', 'na', 'no', 'com', 'para', 'por']);
  function titulo(s) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (/[a-zà-ÿ]/.test(t)) return t.charAt(0).toUpperCase() + t.slice(1); // já vem com minúsculas: respeita (ex.: PucPr)
    return t.toLowerCase().split(' ').map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  }

  /* ---------- 1) itens de texto do PDF -> linhas da tabela (não usa o navegador) ---------- */
  function celulasDe(itens) {
    const ord = itens.slice().sort((a, b) => a.x - b.x);
    const cels = [];
    for (const it of ord) {
      const x2 = it.x + Math.max(0, it.w);
      const ult = cels[cels.length - 1];
      const junta = Math.max(4, (it.h || 10) * 0.5); // espaço entre palavras junta; espaço entre colunas separa
      if (ult && it.x - ult.x2 <= junta) {
        ult.texto += (it.x - ult.x2 > 1 ? ' ' : '') + it.str;
        ult.x2 = Math.max(ult.x2, x2);
      } else cels.push({ x: it.x, x2, texto: it.str });
    }
    cels.forEach((c) => { c.texto = c.texto.replace(/\s+/g, ' ').trim(); });
    return cels.filter((c) => c.texto);
  }
  function agruparLinhas(itens) {
    const validos = (itens || []).filter((it) => it && typeof it.str === 'string' && it.str.trim())
      .map((it) => ({ str: it.str, x: Number(it.x) || 0, y: Number(it.y) || 0, w: Number(it.w) || 0, h: Math.abs(Number(it.h)) || 0 }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const linhas = [];
    for (const it of validos) {
      const ult = linhas[linhas.length - 1];
      if (ult && Math.abs(ult.y - it.y) <= Math.max(2, (it.h || 10) * 0.25)) ult.itens.push(it);
      else linhas.push({ y: it.y, itens: [it] });
    }
    return linhas.map((l) => ({ y: l.y, celulas: celulasDe(l.itens) }));
  }
  function lerValor(txt) {
    const t = String(txt).replace(/\s+/g, '').replace(/−/g, '-').replace('R$', '');
    const m = /^([-+]?)(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})(-?)$/.exec(t);
    if (!m) return null;
    const v = Number(m[2].replace(/\./g, '') + '.' + m[3]);
    return m[1] === '-' || m[4] === '-' ? -v : v;
  }

  /* paginas: [[{ str, x, y, w, h }]] (coordenadas do PDF, y cresce para cima) */
  function interpretar(paginas) {
    const out = { titular: null, periodo: null, saldoConta: null, linhas: [], saldos: [], achouTabela: false, temItau: false };
    let colValor = null, colSaldo = null, ultimaData = null, esperaSaldoConta = false;
    for (const itens of paginas || []) {
      let rodape = false;
      for (const lin of agruparLinhas(itens)) {
        const cels = lin.celulas;
        if (!cels.length) continue;
        const texto = cels.map((c) => c.texto).join(' ');
        const N = norm(texto);
        if (N.includes('ITAU')) out.temItau = true;
        if (rodape) continue;
        if (/^AVISO\b/.test(N)) { rodape = true; continue; }
        if (!out.achouTabela) {
          // "saldo em conta" do cabeçalho: o valor vem na linha de baixo, primeira coluna
          if (esperaSaldoConta) { esperaSaldoConta = false; const v = lerValor(cels[0].texto); if (v !== null) out.saldoConta = v; }
          if (/^SALDO EM CONTA\b/.test(N) && out.saldoConta == null) esperaSaldoConta = true;
          if (!out.titular) {
            const m = /^(.*?)\s*[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}(?![\d*])/.exec(texto);
            if (m && /\p{L}/u.test(m[1]) && !/\d/.test(m[1])) out.titular = m[1].trim();
          }
          if (!out.periodo) {
            const m = /PERIODO DE VISUALIZACAO:?\s*(\d{2}\/\d{2}\/\d{4})\s*ATE\s*(\d{2}\/\d{2}\/\d{4})/.exec(N);
            if (m && isoDeBR(m[1]) && isoDeBR(m[2])) out.periodo = { de: isoDeBR(m[1]), ate: isoDeBR(m[2]) };
          }
        }
        if (/^DATA\b/.test(N) && N.includes('LANCAMENTO') && N.includes('VALOR')) {
          out.achouTabela = true;
          const cv = cels.find((c) => /^VALOR/.test(norm(c.texto)));
          const cs = cels.find((c) => /^SALDO/.test(norm(c.texto)));
          colValor = cv ? { x: cv.x, x2: cv.x2 } : null;
          colSaldo = cs ? { x: cs.x, x2: cs.x2 } : null;
          continue;
        }
        if (!out.achouTabela) continue;

        let data = null;
        const desc = [], nums = [];
        cels.forEach((c, i) => {
          let t = c.texto;
          if (i === 0) {
            const m = /^(\d{2}\/\d{2}\/\d{4})\s*(.*)$/.exec(t);
            if (m && isoDeBR(m[1])) { data = isoDeBR(m[1]); t = m[2]; }
          }
          if (!t) return;
          const v = lerValor(t);
          if (v !== null && (!colValor || c.x2 >= colValor.x)) nums.push({ v, x2: c.x2 });
          else desc.push(t);
        });
        const descricao = desc.join(' ').replace(/\s+/g, ' ').trim();
        const D = norm(descricao);
        let valor = null, saldo = null;
        if (nums.length) {
          if (colValor && colSaldo) {
            nums.forEach((n) => { if (Math.abs(n.x2 - colSaldo.x2) < Math.abs(n.x2 - colValor.x2)) saldo = n.v; else valor = n.v; });
          } else if (/^SALDO\b/.test(D)) saldo = nums[nums.length - 1].v;
          else { valor = nums[0].v; if (nums[1]) saldo = nums[1].v; }
        }
        if (data) ultimaData = data;
        const dia = data || ultimaData;
        if (/^SALDO\b/.test(D)) {
          const s = saldo != null ? saldo : valor;
          if (/^SALDO (DO DIA|ANTERIOR)\b/.test(D) && s != null && dia) out.saldos.push({ data: dia, saldo: s });
          continue;
        }
        if (!descricao || valor == null || valor === 0 || !dia) continue;
        out.linhas.push({ dataLancamento: dia, descricaoOriginal: descricao, valor });
      }
    }
    return out;
  }

  /* Entre dois "SALDO DO DIA": saldo anterior + lançamentos dos dias seguintes até o outro saldo = saldo seguinte.
     Agrupa pela data (a posição do "SALDO DO DIA" dentro do dia varia no PDF). Diferença num trecho que se desfaz no
     seguinte é lançamento de feriado/fim de semana com a data do dia útil: a soma acumulada é que precisa voltar a zero.
     Lançamentos depois do último saldo: ou o último saldo já os inclui, ou o "saldo em conta" do cabeçalho confirma. */
  function conferir(linhas, saldos, saldoConta) {
    const S = new Map();
    saldos.forEach((s) => S.set(s.data, centavos(s.saldo)));
    const datas = Array.from(S.keys()).sort();
    if (datas.length < 2) {
      return { conferido: false, aviso: 'Não encontrei os saldos do dia no PDF para conferir a leitura. Confira os lançamentos antes de importar.', semConferir: 0 };
    }
    const soma = (f) => linhas.filter(f).reduce((a, l) => a + centavos(l.valor), 0);
    const conta = (f) => linhas.filter(f).length;
    let acumulado = 0, aberto = null;
    for (let i = 1; i < datas.length; i++) {
      const de = datas[i - 1], ate = datas[i];
      acumulado += S.get(ate) - S.get(de) - soma((l) => l.dataLancamento > de && l.dataLancamento <= ate);
      if (acumulado === 0) aberto = null;
      else if (!aberto) aberto = ate;
    }
    const primeiro = datas[0], ultimo = datas[datas.length - 1];
    const antes = conta((l) => l.dataLancamento <= primeiro);
    const nDepois = conta((l) => l.dataLancamento > ultimo);
    const depois = soma((l) => l.dataLancamento > ultimo);
    const conta0 = S.get(primeiro) + soma((l) => l.dataLancamento > primeiro);
    const bateConta = saldoConta != null && conta0 === centavos(saldoConta);
    if (acumulado === 0) return { conferido: true, aviso: null, semConferir: antes + (nDepois && !bateConta ? nDepois : 0) };
    if (nDepois && acumulado === depois) return { conferido: true, aviso: null, semConferir: antes };
    const dif = Math.abs(acumulado - (nDepois && Math.abs(acumulado - depois) < Math.abs(acumulado) ? depois : 0));
    return {
      conferido: false, semConferir: 0, // o aviso já cobre tudo
      aviso: 'Os saldos do extrato não bateram com os lançamentos lidos a partir de ' + dataBR(aberto || primeiro) +
        ' (diferença de ' + R(dif / 100) + '). Pode ter faltado alguma linha: confira antes de importar.',
    };
  }

  /* ---------- 2) descrição: data real, nome limpo e padrão do estabelecimento ---------- */
  const PREFIXO_CARTAO = /^(PAY|RSCSS|RSHOP|RPASS)\s+/i;
  function separarData(desc) {
    let m = /^(.*?)[\s\-–]*(\d{2})\/(\d{2})$/.exec(desc);
    if (m) return { resto: m[1], dd: +m[2], mm: +m[3] };
    if (PREFIXO_CARTAO.test(desc)) {
      m = /^(.*?\D)(\d{2})(\d{2})$/.exec(desc);
      if (m) return { resto: m[1], dd: +m[2], mm: +m[3] };
    }
    return { resto: desc, dd: null, mm: null };
  }
  function dataReal(sep, dataLancamento) {
    if (!sep.dd) return dataLancamento;
    const ano = Number(dataLancamento.slice(0, 4));
    for (const y of [ano, ano - 1]) {
      const iso = isoValida(y, sep.mm, sep.dd);
      if (!iso || iso > dataLancamento) continue; // caiu depois do lançamento: é do ano anterior
      return diasEntre(iso, dataLancamento) <= JANELA_DATA ? iso : dataLancamento;
    }
    return dataLancamento;
  }
  const semPontaSolta = (s) => String(s).replace(/[\s.\-–*/]+$/, '').trim();
  function limpar(original, tipo) {
    const r = semPontaSolta(separarData(original).resto);
    const N = norm(r);
    let m;
    if (/^(REMUNERACAO|SALARIO)\b/.test(N)) return 'Salário';
    if (/^APLICACAO COFRINHO/.test(N)) return 'Aplicação no Cofrinho';
    if (/^RESGATE COFRINHO/.test(N)) return 'Resgate do Cofrinho';
    if (/^REND PAGO APLIC/.test(N)) return 'Rendimento da aplicação automática';
    if (/^INT PRE-?PAGO/.test(N)) { m = /(\d{4})$/.exec(N); return 'Pré-pago' + (m ? ' final ' + m[1] : ''); }
    if (/^FATURA PAGA\b/.test(N)) return semPontaSolta('Fatura paga ' + titulo(r.replace(/^fatura\s+paga\s*/i, '')));
    if (/^TED\b/.test(N)) return /^TED\s*C\b/.test(N) ? 'TED recebida' : /^TED\s*D\b/.test(N) ? 'TED enviada' : 'TED';
    if ((m = /^PIX\s+TRANSF\s+(.+)$/i.exec(r))) return (tipo === 'entrada' ? 'Pix de ' : 'Pix para ') + titulo(m[1]);
    if ((m = /^DEV\s+PIX\s+(.+)$/i.exec(r))) return 'Devolução Pix ' + titulo(m[1]);
    if ((m = /^PIX\s+QRS\s+(.+)$/i.exec(r))) return (tipo === 'entrada' ? 'Pix de ' : '') + titulo(m[1]);
    if ((m = /^(?:PAY|RSCSS|RSHOP|RPASS)\s+(.+)$/i.exec(r))) return titulo(m[1]);
    return titulo(r) || titulo(original);
  }
  /* Chave do estabelecimento: sem acento, sem a data colada, sem o prefixo do meio de pagamento, em minúsculas.
     Ex.: 'PIX QRS UBER DO BRA29/10' -> 'uber do bra'; 'RSCSS DROGARIAS NI2410' -> 'drogarias ni'. */
  function padraoDe(descricaoOriginal) {
    let N = norm(separarData(String(descricaoOriginal == null ? '' : descricaoOriginal).replace(/\s+/g, ' ').trim()).resto);
    N = N.replace(/^(PIX QRS|PAY|RSCSS|RSHOP|RPASS)\s+/, '');
    if (/^TED\b/.test(N)) N = N.replace(/^(TED\s*[A-Z]?\s*INT).*$/, '$1');
    N = N.replace(/X{3,}[\s\d]*$/, '');
    return semPontaSolta(N).toLowerCase();
  }
  const normPadrao = (p) => String(p == null ? '' : p).replace(/\s+/g, ' ').trim().toLowerCase();
  const nomeBase = (padrao) => padrao.replace(/^(pix transf|dev pix)\s+/, '').toUpperCase();
  const nomesCasam = (a, b) => !!a && !!b && (a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))));

  /* ---------- 3) lançamentos (chave estável + id) ---------- */
  function sha256HexJS(texto) {
    const bytes = new TextEncoder().encode(texto);
    const K = [], H = [];
    for (let n = 2, c = 0; c < 64; n++) {
      let primo = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { primo = false; break; }
      if (!primo) continue;
      if (c < 8) H.push((Math.pow(n, 1 / 2) % 1) * 4294967296 | 0);
      K.push((Math.pow(n, 1 / 3) % 1) * 4294967296 | 0);
      c++;
    }
    const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
    const msg = new Uint8Array(total);
    msg.set(bytes); msg[len] = 0x80;
    const dv = new DataView(msg.buffer);
    dv.setUint32(total - 4, (len * 8) >>> 0);
    dv.setUint32(total - 8, Math.floor((len * 8) / 4294967296));
    const w = new Int32Array(64);
    const rot = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getInt32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rot(w[i - 15], 7) ^ rot(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rot(w[i - 2], 17) ^ rot(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  async function sha256Hex(texto) {
    const c = typeof crypto !== 'undefined' ? crypto : null;
    if (c && c.subtle && typeof c.subtle.digest === 'function') {
      try {
        const buf = await c.subtle.digest('SHA-256', new TextEncoder().encode(texto));
        return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
      } catch (e) { /* sem crypto.subtle (página sem https): calcula em JS, dá o mesmo resultado */ }
    }
    return sha256HexJS(texto);
  }
  async function montarLancamentos(linhas) {
    const vistos = new Map();
    return Promise.all(linhas.map(async (ln) => {
      const original = String(ln.descricaoOriginal).normalize('NFC').replace(/\s+/g, ' ').trim();
      const cent = centavos(ln.valor);
      const base = ln.dataLancamento + '|' + original + '|' + (cent / 100).toFixed(2);
      const n = vistos.get(base) || 0; // linhas idênticas no mesmo dia: 0, 1, 2…
      vistos.set(base, n + 1);
      const chave = base + '|' + n;
      const tipo = cent < 0 ? 'gasto' : 'entrada';
      return {
        chave,
        id: 'ext-' + (await sha256Hex(chave)).slice(0, 24),
        data: dataReal(separarData(original), ln.dataLancamento),
        dataLancamento: ln.dataLancamento,
        descricao: limpar(original, tipo),
        descricaoOriginal: original,
        valor: Math.abs(cent) / 100,
        tipo,
        categoria: null,
        acao: 'revisar',
        motivo: '',
      };
    }));
  }

  /* ---------- 4) classificação ---------- */
  function tipoDaLinha(N) {
    if (/\b(REMUNERACAO|SALARIO)\b/.test(N)) return 'salario';
    if (/\b(APLICACAO|RESGATE)\b.*\bCOFRINHO/.test(N)) return 'cofrinho';
    if (/^REND PAGO\b/.test(N)) return 'rendimento';
    if (/^(APL|RES)\.? APLIC AUT\b/.test(N)) return 'aplicAut';
    if (/^PIX TRANSF\b/.test(N)) return 'pixTransf';
    if (/^DEV PIX\b/.test(N)) return 'dev';
    if (/^PIX QRS\b/.test(N)) return 'pixQrs';
    if (/^TED\b/.test(N)) return 'ted';
    if (/^INT PRE-?PAGO/.test(N)) return 'prepago';
    if (/^FATURA PAGA\b/.test(N)) return 'fatura';
    return 'outro';
  }
  function categoriaPadrao(N) {
    for (const [cat, res] of REGRAS_PADRAO) if (res.some((re) => re.test(N))) return cat;
    return null;
  }
  function propriaPorNome(titular) {
    const T = norm(titular || '');
    if (!T) return () => false;
    const minimo = Math.min(7, T.split(' ')[0].length);
    return (x) => {
      if (x.tl !== 'pixTransf' && x.tl !== 'dev' && x.tl !== 'pixQrs') return false;
      const nome = nomeBase(x.p);
      return nome.length >= minimo && T.startsWith(nome);
    };
  }
  /* lista: lançamentos (são alterados aqui). ctx: { ehPropria(x), regras: Map(padrao -> regra) | null, catValida(id) } */
  function classificar(lista, ctx) {
    const marcar = (l, acao, motivo, categoria) => {
      l.acao = acao; l.motivo = motivo;
      l.categoria = l.tipo === 'gasto' && categoria && ctx.catValida(categoria) ? categoria : null;
    };
    const info = lista.map((l) => {
      const N = norm(l.descricaoOriginal);
      return { l, N, tl: tipoDaLinha(N), p: padraoDe(l.descricaoOriginal), motivoAntes: l.motivo, estrutural: false, par: null, repetido: false };
    });
    // a) dinheiro que continua seu: salário, Cofrinho, rendimento, transferências entre as suas contas
    info.forEach((x) => {
      let motivo = null;
      if (x.tl === 'salario' && x.l.tipo === 'entrada') motivo = M.salario;
      else if (x.tl === 'cofrinho') motivo = /^RESGATE/.test(x.N) ? M.resgate : M.aplicacao;
      else if (x.tl === 'rendimento') motivo = M.rendimento;
      else if (x.tl === 'aplicAut') motivo = M.aplicAut;
      else if (ctx.ehPropria(x)) motivo = M.propria;
      if (motivo) { marcar(x.l, 'ignorar', motivo, null); x.estrutural = true; }
    });
    // b) compra + "DEV PIX" do mesmo estabelecimento e valor: os dois ficam de fora
    info.filter((x) => !x.estrutural && x.tl === 'dev')
      .sort((a, b) => a.l.dataLancamento.localeCompare(b.l.dataLancamento))
      .forEach((d) => {
        const nome = nomeBase(d.p);
        let melhor = null;
        info.forEach((x) => {
          if (x === d || x.estrutural || x.par || x.tl === 'dev' || x.l.tipo === d.l.tipo) return;
          if (centavos(x.l.valor) !== centavos(d.l.valor) || x.l.dataLancamento > d.l.dataLancamento) return;
          if (!nomesCasam(nomeBase(x.p), nome)) return;
          if (!melhor || x.l.dataLancamento > melhor.l.dataLancamento) melhor = x;
        });
        if (!melhor) return;
        d.par = melhor; melhor.par = d;
        d.estrutural = melhor.estrutural = true;
        marcar(d.l, 'ignorar', M.devolvido(ddmm(d.l.data)), null);
        marcar(melhor.l, 'ignorar', M.devolvido(ddmm(d.l.data)), null);
      });
    // c) regras do usuário, d) regras padrão
    info.forEach((x) => {
      if (x.estrutural) return;
      const l = x.l;
      const regra = ctx.regras && x.p ? ctx.regras.get(x.p) : null;
      if (regra) {
        x.regra = regra;
        if (regra.acao === 'ignorar') return marcar(l, 'ignorar', M.regraIgnorar, null);
        if (regra.acao === 'revisar') return marcar(l, 'revisar', M.regraRevisar, regra.categoria || categoriaPadrao(x.N));
        return marcar(l, 'importar', M.regraImportar, regra.categoria || categoriaPadrao(x.N));
      }
      if (l.tipo === 'entrada') {
        const motivo = x.tl === 'pixTransf' || x.tl === 'pixQrs' ? M.pixRecebido : x.tl === 'ted' ? M.tedRecebida : x.tl === 'dev' ? M.devSemPar : M.entrada;
        return marcar(l, 'revisar', motivo, null);
      }
      const revisar = { pixTransf: M.pixEnviado, ted: M.tedEnviada, prepago: M.prepago, fatura: M.fatura, dev: M.devEnviada }[x.tl];
      if (revisar) return marcar(l, 'revisar', revisar, null);
      const cat = categoriaPadrao(x.N);
      marcar(l, 'importar', cat && ctx.catValida(cat) ? M.reconhecido : M.novo, cat);
    });
    return info;
  }

  /* ---------- 5) leitura do PDF no navegador ---------- */
  let ultima = null; // última leitura (só em memória): período, conferência e titular
  let carregando = null;
  function carregarPdfJs() {
    if (!carregando) {
      carregando = (async () => {
        let lib = typeof window !== 'undefined' ? window.pdfjsLib : null;
        if (!lib || typeof lib.getDocument !== 'function') {
          await new Promise((ok, falha) => {
            const src = PDFJS + 'pdf.min.js';
            const el = document.createElement('script');
            el.src = src; el.integrity = SRI_PDFJS; el.crossOrigin = 'anonymous'; el.dataset.src = src;
            el.onload = () => ok(); el.onerror = () => falha(new Error('pdfjs'));
            document.head.appendChild(el);
          });
          lib = window.pdfjsLib;
          if (!lib || typeof lib.getDocument !== 'function') throw new Error('pdfjs');
        }
        const opc = lib.GlobalWorkerOptions;
        if (opc && !opc.workerSrc && !opc.workerPort) {
          // o worker também é conferido pelo hash; vira um endereço blob: da própria página
          const r = await fetch(PDFJS + 'pdf.worker.min.js', { integrity: SRI_WORKER, mode: 'cors', credentials: 'omit' });
          if (!r.ok) throw new Error('worker ' + r.status);
          opc.workerSrc = URL.createObjectURL(await r.blob());
        }
        return lib;
      })().catch((e) => { carregando = null; throw e; });
    }
    return carregando;
  }
  async function bytesDe(file) {
    if (file instanceof ArrayBuffer) return new Uint8Array(file);
    if (ArrayBuffer.isView(file)) return new Uint8Array(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    if (file && typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
    if (file && typeof FileReader !== 'undefined') {
      return new Promise((ok, falha) => {
        const fr = new FileReader();
        fr.onload = () => ok(new Uint8Array(fr.result));
        fr.onerror = () => falha(fr.error || new Error('leitura'));
        fr.readAsArrayBuffer(file);
      });
    }
    throw new Error('Escolha o arquivo PDF do extrato.');
  }
  async function extrairPaginas(file) {
    if (!file) throw new Error('Escolha o arquivo PDF do extrato.');
    if (file.name && file.type && !/pdf/i.test(file.type) && !/\.pdf$/i.test(file.name)) throw new Error('Esse arquivo não é um PDF. Escolha o PDF do extrato do Itaú.');
    if (file.size > MAX_BYTES) throw new Error('Esse PDF é grande demais para um extrato. Confira se escolheu o arquivo certo.');
    let lib;
    try { lib = await carregarPdfJs(); } catch (e) { throw new Error('Não consegui carregar o leitor de PDF. Confira a internet e tente de novo.'); }
    const dados = await bytesDe(file);
    let doc;
    try {
      doc = await lib.getDocument({ data: dados, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('Esse PDF tem senha. Baixe o extrato de novo, sem senha, e tente outra vez.');
      throw new Error(NAO_RECONHECI);
    }
    try {
      if (doc.numPages > MAX_PAGINAS) throw new Error('Esse PDF tem páginas demais para um extrato. Baixe um período menor.');
      const paginas = [];
      for (let p = 1; p <= doc.numPages; p++) {
        const pg = await doc.getPage(p);
        const tc = await pg.getTextContent();
        paginas.push(tc.items.filter((it) => typeof it.str === 'string').map((it) => ({
          str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || it.height || 0,
        })));
        if (typeof pg.cleanup === 'function') pg.cleanup();
      }
      return paginas;
    } catch (e) {
      if (e && /páginas demais/.test(e.message || '')) throw e;
      throw new Error('Não consegui ler esse PDF. Baixe o extrato de novo e tente outra vez.');
    } finally {
      try { doc.destroy(); } catch (e) { /* nada a fazer */ }
    }
  }
  async function montarLeitura(paginas) {
    const r = interpretar(paginas);
    if (!r.achouTabela || (!r.temItau && !r.saldos.length)) throw new Error(NAO_RECONHECI);
    const conf = conferir(r.linhas, r.saldos, r.saldoConta);
    const lancamentos = await montarLancamentos(r.linhas);
    classificar(lancamentos, { ehPropria: propriaPorNome(r.titular), regras: null, catValida: () => true });
    let periodo = r.periodo;
    if (!periodo && lancamentos.length) {
      const ds = lancamentos.map((l) => l.dataLancamento).sort();
      periodo = { de: ds[0], ate: ds[ds.length - 1] };
    }
    ultima = { lancamentos, titular: r.titular, periodo: periodo || null, conferido: conf.conferido, aviso: conf.aviso, semConferir: conf.semConferir };
    return { banco: 'itau', titular: r.titular, periodo: periodo || null, conferido: conf.conferido, aviso: conf.aviso, lancamentos };
  }
  async function ler(file) {
    const paginas = await extrairPaginas(file);
    try {
      return await montarLeitura(paginas);
    } catch (e) {
      if (e && e.message === NAO_RECONHECI) throw e;
      console.error('extrato', e);
      throw new Error('Não consegui entender esse PDF. Confira se é o extrato da conta do Itaú e tente de novo.');
    }
  }

  /* ---------- 6) preparação da revisão (regras do usuário, já importados, parece já lançado) ---------- */
  function listaCategorias(cats) {
    const lista = Array.isArray(cats) && cats.length ? cats : CATEGORIAS;
    return lista.map((c) => (Array.isArray(c) ? [String(c[0]), String(c[1] == null ? c[0] : c[1])] : c && c.id ? [String(c.id), String(c.nome || c.id)] : null)).filter(Boolean);
  }
  function preparar(opcoes) {
    const op = opcoes || {};
    const categorias = listaCategorias(op.categorias);
    const validas = new Set(categorias.map((c) => c[0]));
    const nomeCat = (id) => { const c = categorias.find((x) => x[0] === id); return c ? c[1] : ''; };
    const movs = (Array.isArray(op.movs) ? op.movs : []).filter((m) => m && typeof m === 'object');
    const fixos = (Array.isArray(op.fixos) ? op.fixos : []).filter((f) => f && typeof f === 'object');
    const regras = new Map();
    (Array.isArray(op.regras) ? op.regras : []).forEach((r) => { if (r && r.padrao) regras.set(normPadrao(r.padrao), r); });
    const lancs = (Array.isArray(op.lancamentos) ? op.lancamentos : []).filter((l) => l && l.chave && l.id).map((l) => Object.assign({}, l));
    const porNome = propriaPorNome(ultima && ultima.titular);
    const info = classificar(lancs, { ehPropria: (x) => x.motivoAntes === M.propria || porNome(x), regras, catValida: (c) => validas.has(c) });

    const ids = new Set(movs.map((m) => m.id).filter(Boolean));
    const chaves = new Set(movs.map((m) => m.chaveExtrato).filter(Boolean));
    const jaFoi = (x) => ids.has(x.l.id) || chaves.has(x.l.chave);
    const itens = info.filter((x) => !jaFoi(x));
    const jaImportados = info.length - itens.length;

    // compra e devolução com um dos lados já importado antes: o outro lado vai para conferência
    itens.forEach((x) => {
      if (!x.par || !jaFoi(x.par)) return;
      x.estrutural = false;
      x.l.acao = 'revisar';
      x.l.motivo = x.tl === 'dev' ? 'Devolução de uma compra que você já importou (' + ddmm(x.par.l.data) + '): confira' : 'A devolução desta compra já foi importada: confira';
      x.l.categoria = x.l.tipo === 'gasto' && validas.has(categoriaPadrao(x.N)) ? categoriaPadrao(x.N) : null;
    });

    // parece já lançado: gasto salvo sem chaveExtrato (à mão ou de um fixo), mesmo valor e data a até 3 dias
    const nomeFixo = (id) => { const f = fixos.find((x) => x.id === id); return f && f.nome ? String(f.nome) : ''; };
    const salvos = movs.filter((m) => m.tipo === 'gasto' && !m.chaveExtrato && m.origem !== 'extrato' && Number(m.valor) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(m.data || '')));
    const usados = new Set();
    itens.filter((x) => x.l.tipo === 'gasto' && x.l.acao !== 'ignorar')
      .sort((a, b) => a.l.data.localeCompare(b.l.data))
      .forEach((x) => {
        let melhor = null, dist = Infinity;
        salvos.forEach((m) => {
          if (usados.has(m) || Math.abs(centavos(m.valor) - centavos(x.l.valor)) > 1) return;
          const d = Math.abs(diasEntre(m.data, x.l.data));
          if (d <= JANELA_REPETIDO && d < dist) { melhor = m; dist = d; }
        });
        if (!melhor) return;
        usados.add(melhor);
        x.repetido = true;
        const nome = (melhor.fixoId && nomeFixo(melhor.fixoId)) || (melhor.descricao ? String(melhor.descricao) : '') || nomeCat(melhor.categoria) || 'gasto';
        x.l.acao = 'revisar';
        x.l.motivo = 'Parece já lançado: ' + nome + ' ' + R(melhor.valor) + ' em ' + ddmm(melhor.data);
      });

    // gasto fixo que ainda não foi lançado no mês, com o mesmo valor e perto do dia combinado
    const distDia = (iso, dia) => {
      const [y, m] = iso.split('-').map(Number);
      return Math.min(...[-1, 0, 1].map((k) => {
        const ult = new Date(Date.UTC(y, m - 1 + k + 1, 0)).getUTCDate();
        const alvo = Date.UTC(y, m - 1 + k, Math.min(Number(dia), ult));
        return Math.abs(Math.round((alvo - utc(iso)) / 864e5));
      }));
    };
    const ativos = fixos.filter((f) => f.ativo !== false && Number(f.valor) > 0 && Number(f.dia) >= 1);
    itens.filter((x) => x.l.tipo === 'gasto' && x.l.acao !== 'ignorar' && !x.repetido).forEach((x) => {
      const f = ativos.find((fx) => Math.abs(centavos(fx.valor) - centavos(x.l.valor)) <= 1 && distDia(x.l.data, fx.dia) <= JANELA_REPETIDO &&
        !movs.some((m) => m.fixoId === fx.id && String(m.data || '').slice(0, 7) === x.l.data.slice(0, 7)));
      if (!f) return;
      x.repetido = true;
      x.l.acao = 'revisar';
      x.l.motivo = 'Parece ser o gasto fixo “' + String(f.nome || 'sem nome') + '” (dia ' + Number(f.dia) + ')';
    });

    return { itens, jaImportados, categorias, nomeCat };
  }

  /* ---------- 7) tela de revisão ---------- */
  const CSS = [
    '.ext-imp { display: flex; flex-direction: column; gap: 14px; }',
    '.ext-imp-topo .ext-imp-totais { font-weight: 600; }',
    '.ext-imp-confere { font-size: .88rem; font-weight: 600; }',
    '.ext-imp-lista { display: flex; flex-direction: column; }',
    '.ext-imp-item { display: flex; align-items: flex-start; gap: 12px; padding-block: 10px; border-bottom: 1px solid var(--line); }',
    '.ext-imp-item:first-child { padding-top: 0; }',
    '.ext-imp-item:last-child { border-bottom: 0; padding-bottom: 0; }',
    '.ext-imp-chk { flex: none; width: 22px; height: 22px; margin: 1px 0 0; accent-color: var(--invest); cursor: pointer; }',
    '.ext-imp-corpo { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }',
    '.ext-imp-l1 { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; cursor: pointer; }',
    '.ext-imp-nome { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }',
    '.ext-imp-valor { white-space: nowrap; font-weight: 600; }',
    '.ext-imp-l2 { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: .82rem; color: var(--muted); }',
    '.ext-imp-l2 .mini-sel { max-width: 100%; }',
    '.ext-imp-motivo { font-size: .78rem; color: var(--muted); }',
    '.ext-imp-item.off .ext-imp-nome, .ext-imp-item.off .ext-imp-valor { color: var(--muted); font-weight: 500; }',
    '.ext-imp-item.semcat .ext-imp-cat { border-color: var(--mine); color: var(--mine); }',
    '.ext-imp-regra:empty { display: none; }',
    '.ext-imp-regra .link { padding: 2px 0; text-align: left; }',
    '.ext-imp-ign > summary { cursor: pointer; font-weight: 600; list-style: none; display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }',
    '.ext-imp-ign > summary::-webkit-details-marker { display: none; }',
    '.ext-imp-ign > summary::after { content: "Mostrar"; color: var(--muted); font-weight: 500; font-size: .85rem; }',
    '.ext-imp-ign[open] > summary::after { content: "Esconder"; }',
    '.ext-imp-ign[open] > summary { margin-bottom: 4px; }',
    '.ext-imp-barra { position: sticky; bottom: 0; z-index: 2; background: var(--bg); border-top: 1px solid var(--line); padding: 10px 0 calc(10px + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 8px; }',
  ].join('\n');
  function injetarCss() {
    if (document.getElementById('ext-imp-css')) return;
    const st = document.createElement('style');
    st.id = 'ext-imp-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function abrirRevisao(opcoes) {
    return new Promise((resolve, reject) => {
      const op = opcoes || {};
      const box = op.container;
      if (!box || typeof box.querySelector !== 'function') { reject(new Error('Faltou o lugar da tela de revisão.')); return; }
      if (typeof op.salvar !== 'function') { reject(new Error('Faltou a função de salvar da revisão.')); return; }
      let prep;
      try { prep = preparar(op); } catch (e) { reject(e); return; }
      injetarCss();

      const usarUltima = ultima && (ultima.lancamentos === op.lancamentos || !op.periodo);
      const meta = {
        periodo: op.periodo || (usarUltima ? ultima.periodo : null),
        conferido: op.conferido != null ? !!op.conferido : !!(usarUltima && ultima.conferido),
        aviso: op.aviso != null ? op.aviso : usarUltima ? ultima.aviso : null,
        semConferir: usarUltima ? ultima.semConferir : 0,
      };
      const { categorias, nomeCat } = prep;
      const itens = prep.itens.map((x, k) => ({ k, x, l: x.l, base: x.l.acao, marcado: x.l.acao === 'importar', travado: !!(x.estrutural || x.repetido), padrao: x.p }));
      const regrasNovas = new Map();
      const uid = 'ext' + Math.random().toString(36).slice(2, 8);
      let terminou = false, salvando = false;

      const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);
      const linhaHtml = (it) => {
        const l = it.l, idc = uid + '-' + it.k, gasto = l.tipo === 'gasto';
        const quando = ddmm(l.data) + (l.data !== l.dataLancamento ? ' · no banco em ' + ddmm(l.dataLancamento) : '');
        const sel = gasto
          ? '<select class="mini-sel ext-imp-cat" data-k="' + it.k + '" aria-label="Categoria de ' + esc(l.descricao) + '">' +
            (l.categoria ? '' : '<option value="" selected>Escolha a categoria</option>') +
            categorias.map((c) => '<option value="' + esc(c[0]) + '"' + (c[0] === l.categoria ? ' selected' : '') + '>' + esc(c[1]) + '</option>').join('') + '</select>'
          : '<span>Entrada</span>';
        return '<div class="ext-imp-item' + (it.marcado ? '' : ' off') + (gasto && !l.categoria && it.marcado ? ' semcat' : '') + '" data-k="' + it.k + '">' +
          '<input type="checkbox" class="ext-imp-chk" id="' + idc + '" data-k="' + it.k + '"' + (it.marcado ? ' checked' : '') + '>' +
          '<div class="ext-imp-corpo">' +
          '<label class="ext-imp-l1" for="' + idc + '"><span class="ext-imp-nome">' + esc(l.descricao) + '</span>' +
          '<span class="ext-imp-valor' + (gasto ? '' : ' t-invest') + '">' + (gasto ? '− ' : '+ ') + esc(R(l.valor)) + '</span></label>' +
          '<div class="ext-imp-l2"><span>' + esc(quando) + '</span>' + sel + '</div>' +
          (l.motivo ? '<p class="ext-imp-motivo">' + esc(l.motivo) + '</p>' : '') +
          '<div class="ext-imp-regra" data-k="' + it.k + '"></div>' +
          '</div></div>';
      };
      const porData = (a, b) => b.l.data.localeCompare(a.l.data) || a.k - b.k;
      const principais = itens.filter((it) => it.base !== 'ignorar').sort(porData);
      const ignorados = itens.filter((it) => it.base === 'ignorar').sort(porData);
      const meses = [];
      principais.forEach((it) => {
        const mes = it.l.data.slice(0, 7);
        if (!meses.length || meses[meses.length - 1].mes !== mes) meses.push({ mes, itens: [] });
        meses[meses.length - 1].itens.push(it);
      });

      let html = '<div class="ext-imp">';
      html += '<section class="card ext-imp-topo"><h3>Extrato do Itaú</h3>';
      if (meta.periodo && meta.periodo.de && meta.periodo.ate) html += '<p class="hint">Período: ' + esc(dataBR(meta.periodo.de)) + ' a ' + esc(dataBR(meta.periodo.ate)) + '</p>';
      html += meta.conferido
        ? '<p class="ext-imp-confere t-invest">✓ Leitura conferida com os saldos do extrato</p>'
        : '<p class="err">' + esc(meta.aviso || 'Não deu para conferir a leitura com os saldos do extrato. Confira os lançamentos antes de importar.') + '</p>';
      if (meta.conferido && meta.semConferir > 0) html += '<p class="hint">' + esc(plural(meta.semConferir, 'lançamento depois do último saldo do dia não pôde', 'lançamentos depois do último saldo do dia não puderam')) + ' ser conferido' + (meta.semConferir === 1 ? '' : 's') + '.</p>';
      if (prep.jaImportados > 0) html += '<p class="hint">' + esc(plural(prep.jaImportados, 'já importado', 'já importados')) + ' antes (não aparece' + (prep.jaImportados === 1 ? '' : 'm') + ' aqui).</p>';
      if (itens.length) {
        html += '<p class="ext-imp-totais" aria-live="polite"></p>';
        html += '<p class="hint">Os marcados entram no app. Os desmarcados ficam de fora: o motivo aparece em cinza. Gasto sem categoria entra como Outro.</p>';
      } else {
        html += '<p class="hint">Tudo deste extrato já está no app.</p>';
      }
      html += '</section>';
      meses.forEach((g) => {
        html += '<section class="card ext-imp-mes"><h3>' + esc(nomeMes(g.mes)) + '</h3><div class="ext-imp-lista">' + g.itens.map(linhaHtml).join('') + '</div></section>';
      });
      if (ignorados.length) {
        html += '<details class="card ext-imp-ign"><summary class="ext-imp-ign-tit"></summary>' +
          '<p class="hint">Salário, Cofrinho, rendimentos, transferências entre as suas contas e compras devolvidas. Marque se quiser importar algum.</p>' +
          '<div class="ext-imp-lista">' + ignorados.map(linhaHtml).join('') + '</div></details>';
      }
      html += '<div class="ext-imp-barra"><p class="err ext-imp-erro" role="alert" hidden></p><div class="actions">' +
        (itens.length
          ? '<button type="button" class="btn-primary ext-imp-salvar"></button><button type="button" class="btn-ghost ext-imp-cancelar">Cancelar</button>'
          : '<button type="button" class="btn-primary ext-imp-fechar">Fechar</button>') +
        '</div></div></div>';
      box.innerHTML = html;

      const root = box.querySelector('.ext-imp');
      const $ = (s) => root.querySelector(s);
      const linhaDe = (k) => root.querySelector('.ext-imp-item[data-k="' + k + '"]');
      const btnSalvar = $('.ext-imp-salvar'), btnCancelar = $('.ext-imp-cancelar'), erroEl = $('.ext-imp-erro');

      function atualizarLinha(it) {
        const el = linhaDe(it.k);
        if (!el) return;
        el.classList.toggle('off', !it.marcado);
        el.classList.toggle('semcat', it.l.tipo === 'gasto' && !it.l.categoria && it.marcado);
        const chk = el.querySelector('.ext-imp-chk');
        if (chk) chk.checked = it.marcado;
        const sel = el.querySelector('.ext-imp-cat');
        if (sel && it.l.categoria) sel.value = it.l.categoria;
      }
      function atualizarTotais() {
        let nG = 0, cG = 0, nE = 0, cE = 0, ignMarcados = 0;
        itens.forEach((it) => {
          if (!it.marcado) return;
          if (it.l.tipo === 'gasto') { nG++; cG += centavos(it.l.valor); } else { nE++; cE += centavos(it.l.valor); }
          if (it.base === 'ignorar') ignMarcados++;
        });
        const tot = $('.ext-imp-totais');
        if (tot) tot.textContent = plural(nG, 'gasto', 'gastos') + ' (' + R(cG / 100) + ') e ' + plural(nE, 'entrada', 'entradas') + ' (' + R(cE / 100) + ') marcados';
        const tit = $('.ext-imp-ign-tit');
        if (tit) tit.textContent = 'Ignorados (' + ignorados.length + ')' + (ignMarcados ? ' · ' + ignMarcados + ' marcado' + (ignMarcados === 1 ? '' : 's') : '');
        const n = nG + nE;
        if (btnSalvar && !salvando) {
          btnSalvar.disabled = n === 0;
          btnSalvar.textContent = n ? 'Importar ' + plural(n, 'lançamento', 'lançamentos') : 'Nada marcado para importar';
        }
      }
      function mesmos(it) {
        return itens.filter((o) => o.padrao && o.padrao === it.padrao && o.l.tipo === it.l.tipo);
      }
      function mostrarRegra(it, tipo) {
        const area = root.querySelector('.ext-imp-regra[data-k="' + it.k + '"]');
        if (!area) return;
        if (!tipo || !it.padrao) { area.innerHTML = ''; return; }
        const nome = '“' + it.l.descricao + '”';
        const n = mesmos(it).length;
        let txt;
        if (tipo === 'cat') {
          const cat = nomeCat(it.l.categoria) || it.l.categoria;
          txt = n > 1 ? 'Usar ' + cat + ' nos ' + n + ' de ' + nome + ' e lembrar' : 'Lembrar ' + cat + ' para ' + nome + ' nas próximas';
        } else if (tipo === 'ignorar') txt = 'Sempre ignorar ' + nome;
        else txt = 'Sempre importar ' + nome;
        area.innerHTML = '<button type="button" class="link ext-imp-lembrar" data-k="' + it.k + '" data-regra="' + tipo + '">' + esc(txt) + '</button>';
      }
      function aplicarRegra(it, tipo) {
        const area = root.querySelector('.ext-imp-regra[data-k="' + it.k + '"]');
        const grupo = mesmos(it);
        if (tipo === 'cat') {
          grupo.forEach((o) => { o.l.categoria = it.l.categoria; atualizarLinha(o); });
          regrasNovas.set(it.padrao, { padrao: it.padrao, categoria: it.l.categoria, acao: 'importar' });
          if (area) area.innerHTML = '<p class="hint">Combinado: ' + esc(it.l.descricao) + ' vai para ' + esc(nomeCat(it.l.categoria) || it.l.categoria) + ' nas próximas importações.</p>';
        } else if (tipo === 'ignorar') {
          grupo.forEach((o) => { if (!o.travado) { o.marcado = false; atualizarLinha(o); } });
          regrasNovas.set(it.padrao, { padrao: it.padrao, categoria: null, acao: 'ignorar' });
          if (area) area.innerHTML = '<p class="hint">Combinado: ' + esc(it.l.descricao) + ' fica de fora nas próximas importações.</p>';
        } else {
          grupo.forEach((o) => { if (!o.travado) { o.marcado = true; atualizarLinha(o); } });
          regrasNovas.set(it.padrao, { padrao: it.padrao, categoria: it.l.tipo === 'gasto' ? it.l.categoria || null : null, acao: 'importar' });
          if (area) area.innerHTML = '<p class="hint">Combinado: ' + esc(it.l.descricao) + ' entra marcado nas próximas importações.</p>';
        }
        atualizarTotais();
      }
      function terminar(res) {
        if (terminou) return;
        terminou = true;
        box.innerHTML = '';
        resolve(res);
      }
      async function salvarTudo() {
        if (salvando || terminou) return;
        const marcados = itens.filter((it) => it.marcado);
        if (!marcados.length) return;
        const agora = new Date().toISOString();
        const prontos = marcados.map((it) => {
          const l = it.l;
          const m = { id: l.id, tipo: l.tipo, valor: centavos(l.valor) / 100, data: l.data, descricao: l.descricao };
          if (l.tipo === 'gasto') m.categoria = l.categoria || 'outro';
          m.origem = 'extrato'; m.banco = 'itau'; m.chaveExtrato = l.chave; m.criadoEm = agora;
          return m;
        });
        salvando = true;
        btnSalvar.disabled = true; btnCancelar.disabled = true;
        btnSalvar.textContent = 'Salvando…';
        erroEl.hidden = true;
        try {
          await op.salvar(prontos, Array.from(regrasNovas.values()));
          terminar({ importados: prontos.length });
        } catch (e) {
          salvando = false;
          btnCancelar.disabled = false;
          const det = e && e.message ? ' (' + e.message + ')' : '';
          erroEl.textContent = 'Não consegui salvar a importação' + det + '. Confira a internet e toque de novo em Importar.';
          erroEl.hidden = false;
          atualizarTotais();
        }
      }

      root.addEventListener('change', (ev) => {
        const t = ev.target;
        if (salvando || !t || !t.dataset || t.dataset.k == null) return;
        const it = itens[Number(t.dataset.k)];
        if (!it) return;
        if (t.classList.contains('ext-imp-chk')) {
          it.marcado = t.checked;
          atualizarLinha(it);
          if (it.travado) mostrarRegra(it, null);
          else if (it.base === 'importar') mostrarRegra(it, it.marcado ? null : 'ignorar');
          else mostrarRegra(it, it.marcado ? 'importar' : null);
          atualizarTotais();
        } else if (t.classList.contains('ext-imp-cat')) {
          it.l.categoria = t.value || null;
          atualizarLinha(it);
          mostrarRegra(it, it.l.categoria ? 'cat' : null);
        }
      });
      root.addEventListener('click', (ev) => {
        const t = ev.target && ev.target.closest ? ev.target.closest('button') : null;
        if (!t || !root.contains(t)) return;
        if (t.classList.contains('ext-imp-lembrar')) {
          const it = itens[Number(t.dataset.k)];
          if (it && !salvando) aplicarRegra(it, t.dataset.regra);
        } else if (t.classList.contains('ext-imp-salvar')) salvarTudo();
        else if (t.classList.contains('ext-imp-cancelar')) { if (!salvando) terminar(null); }
        else if (t.classList.contains('ext-imp-fechar')) terminar({ importados: 0 });
      });
      atualizarTotais();
    });
  }

  window.caixaExtrato = {
    ler,
    abrirRevisao,
    padraoDe,
    // partes sem navegador, para teste
    _interno: { montarLeitura, interpretar, preparar, sha256HexJS },
  };
})();
