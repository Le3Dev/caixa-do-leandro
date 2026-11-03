/* Relatório em PDF (semana ou mês), desenhado direto com o jsPDF: números, gráficos e tabela.
   window.caixaRelatorioPDF(dados) devolve um Blob. Os dados vêm já calculados pela tela (index.html).
   window.caixaRelatorioGastosPDF(dados) faz o relatório "Meus gastos" (mês a mês), também em Blob. */
(() => {
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const n2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  // a fonte padrão do PDF só tem os caracteres latinos: troca o sinal de menos e o espaço fino
  const T = (s) => String(s == null ? '' : s).replace(/−/g, '-').replace(/[  ]/g, ' ').replace(/[▲▼✓]/g, '');
  const R = (v) => brl.format(Number(v) || 0);
  const RS = (v) => (v >= 0 ? '+ ' : '- ') + brl.format(Math.abs(Number(v) || 0));
  const P = (v) => (v >= 0 ? '+' : '-') + n2.format(Math.abs(v)) + '%';
  const dataBR = (iso) => { const [y, m, d] = String(iso).split('-'); return d + '/' + m + '/' + y; };
  const curta = (iso) => { const [, m, d] = String(iso).split('-'); return d + '/' + m; };

  const COR = {
    tinta: [20, 33, 28], suave: [92, 106, 100], linha: [222, 228, 225], fundo: [244, 247, 245],
    verde: [10, 115, 81], verdeClaro: [216, 240, 230], vermelho: [180, 35, 24], cdi: [91, 108, 217],
    ouro: [161, 101, 10], topo: [12, 40, 31],
  };
  const PALETA = [[10, 115, 81], [91, 108, 217], [161, 101, 10], [150, 82, 190], [214, 104, 58], [32, 140, 170], [200, 70, 120], [120, 130, 125], [70, 160, 110], [90, 90, 160]];

  window.caixaRelatorioPDF = function (d) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, H = 297, M = 16, CW = W - 2 * M;
    const cor = (c, tipo) => { if (tipo === 'f') doc.setFillColor(c[0], c[1], c[2]); else if (tipo === 'd') doc.setDrawColor(c[0], c[1], c[2]); else doc.setTextColor(c[0], c[1], c[2]); };
    const fonte = (tam, peso) => { doc.setFont('helvetica', peso || 'normal'); doc.setFontSize(tam); };
    const texto = (s, x, y, o) => doc.text(T(s), x, y, o || {});
    let pagina = 1;
    const rodape = () => {
      fonte(7.5); cor(COR.suave);
      texto('Caixa do Leandro · gerado em ' + d.geradoEm + ' · página ' + pagina, W / 2, H - 8, { align: 'center' });
    };
    const novaPagina = () => { rodape(); doc.addPage(); pagina++; return M + 4; };

    // ---------- topo ----------
    cor(COR.topo, 'f'); doc.rect(0, 0, W, 34, 'F');
    fonte(19, 'bold'); cor([255, 255, 255]); texto(d.titulo, M, 16);
    fonte(10); doc.setTextColor(200, 225, 214);
    texto('De ' + dataBR(d.de) + ' a ' + dataBR(d.ate) + (d.filtro ? ' · ' + d.filtro : ''), M, 24);
    let y = 44;

    // ---------- números principais ----------
    const k = d.kpis;
    const cards = [
      ['Patrimônio hoje', R(k.patrimonio), RS(k.varPatrimonio) + ' no período', k.varPatrimonio >= 0 ? COR.verde : COR.vermelho],
      ['Rendimento', RS(k.rendimento), 'investimentos, sem aportes', k.rendimento >= 0 ? COR.verde : COR.vermelho],
      ['Rentabilidade', P(k.rendPct), 'CDI no período: ' + P(k.cdiPct), k.rendPct >= 0 ? COR.verde : COR.vermelho],
      ['Comparado ao CDI', k.pctDoCdi == null ? '-' : n1.format(k.pctDoCdi) + '% do CDI', k.pctDoCdi == null ? '' : k.pctDoCdi >= 100 ? 'acima do CDI' : 'abaixo do CDI', k.pctDoCdi != null && k.pctDoCdi >= 100 ? COR.verde : COR.vermelho],
    ];
    const gap = 4, cw = (CW - gap * 3) / 4;
    cards.forEach((c, i) => {
      const x = M + i * (cw + gap);
      cor(COR.fundo, 'f'); doc.roundedRect(x, y, cw, 24, 2.5, 2.5, 'F');
      fonte(7.5); cor(COR.suave); texto(c[0], x + 3.5, y + 6);
      fonte(c[1].length > 13 ? 10.5 : 12.5, 'bold'); cor(i === 0 ? COR.tinta : c[3]); texto(c[1], x + 3.5, y + 13.5);
      fonte(7); cor(COR.suave); texto(c[2], x + 3.5, y + 19.5);
    });
    y += 34;

    const titulo = (s, sub) => {
      fonte(12, 'bold'); cor(COR.tinta); texto(s, M, y);
      if (sub) { fonte(8); cor(COR.suave); texto(sub, M, y + 5); y += 5; }
      y += 6;
    };

    // ---------- gráfico: rentabilidade acumulada x CDI ----------
    titulo('Rentabilidade acumulada', 'Sua carteira de investimentos comparada com o CDI no mesmo período');
    {
      const gx = M + 12, gw = CW - 14, gh = 52, gy = y;
      const s = d.serie, n = s.datas.length;
      let lo = Math.min(0, ...s.cart, ...s.cdi), hi = Math.max(0, ...s.cart, ...s.cdi);
      const pad = (hi - lo) * 0.12 || 0.05; lo -= pad; hi += pad;
      const X = (i) => gx + (n <= 1 ? gw / 2 : gw * i / (n - 1));
      const Y = (v) => gy + gh * (1 - (v - lo) / (hi - lo));
      // grade e eixo
      doc.setLineWidth(0.2); cor(COR.linha, 'd');
      fonte(7); cor(COR.suave);
      for (let g = 0; g <= 4; g++) {
        const v = lo + (hi - lo) * g / 4, yy = Y(v);
        doc.line(gx, yy, gx + gw, yy);
        texto(n2.format(v) + '%', gx - 1.5, yy + 1, { align: 'right' });
      }
      doc.setLineWidth(0.4); doc.setDrawColor(150, 160, 155); doc.line(gx, Y(0), gx + gw, Y(0));
      // área e linha da carteira
      const pts = s.cart.map((v, i) => [X(i), Y(v)]);
      if (n > 1) {
        cor(COR.verdeClaro, 'f');
        for (let i = 1; i < n; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], z = Y(0);
          doc.triangle(x0, z, x0, y0, x1, y1, 'F'); doc.triangle(x0, z, x1, y1, x1, z, 'F');
        }
        // CDI tracejado
        doc.setLineWidth(0.6); cor(COR.cdi, 'd'); doc.setLineDashPattern([1.2, 1.2], 0);
        for (let i = 1; i < n; i++) doc.line(X(i - 1), Y(s.cdi[i - 1]), X(i), Y(s.cdi[i]));
        doc.setLineDashPattern([], 0);
        doc.setLineWidth(0.8); cor(COR.verde, 'd');
        for (let i = 1; i < n; i++) doc.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
        cor(COR.verde, 'f'); doc.circle(pts[n - 1][0], pts[n - 1][1], 1.1, 'F');
      }
      // datas no eixo x (até 8)
      fonte(7); cor(COR.suave);
      const passo = Math.max(1, Math.ceil(n / 8));
      for (let i = 0; i < n; i += passo) texto(curta(s.datas[i]), X(i), gy + gh + 4.5, { align: 'center' });
      if ((n - 1) % passo) texto(curta(s.datas[n - 1]), X(n - 1), gy + gh + 4.5, { align: 'center' });
      // legenda
      const ly = gy + gh + 10;
      cor(COR.verde, 'f'); doc.rect(gx, ly - 2, 5, 1.6, 'F'); fonte(8); cor(COR.tinta); texto('Sua carteira ' + P(k.rendPct), gx + 7, ly);
      doc.setLineWidth(0.6); cor(COR.cdi, 'd'); doc.setLineDashPattern([1.2, 1.2], 0); doc.line(gx + 55, ly - 1.2, gx + 60, ly - 1.2); doc.setLineDashPattern([], 0);
      texto('CDI ' + P(k.cdiPct), gx + 62, ly);
      y = ly + 10;
    }

    // ---------- gráfico: o que puxou ----------
    if (d.puxou.length) {
      titulo('O que puxou o resultado', 'Quanto cada investimento ganhou ou perdeu no período, sem contar aportes e corretagem');
      const rows = d.puxou.slice(0, 10);
      const max = Math.max(...rows.map((x) => Math.abs(x.v)), 0.01);
      const nomeW = 62, valW = 28, bx = M + nomeW, bw = CW - nomeW - valW, meio = bx + bw / 2;
      doc.setLineWidth(0.3); cor(COR.linha, 'd'); doc.line(meio, y - 2, meio, y + rows.length * 7.5 - 2);
      rows.forEach((x) => {
        fonte(8.5); cor(COR.tinta); texto(doc.splitTextToSize(T(x.nome), nomeW - 3)[0], M, y + 2);
        const w = Math.abs(x.v) / max * (bw / 2 - 2);
        cor(x.v >= 0 ? COR.verde : COR.vermelho, 'f');
        doc.roundedRect(x.v >= 0 ? meio : meio - w, y - 1.2, Math.max(w, 0.6), 4, 1, 1, 'F');
        fonte(8.5, 'bold'); cor(x.v >= 0 ? COR.verde : COR.vermelho); texto(RS(x.v), M + CW, y + 2, { align: 'right' });
        y += 7.5;
      });
      y += 4;
    }

    // ---------- tabela dos investimentos ----------
    if (y > H - 80) y = novaPagina();
    titulo('Seus investimentos hoje', 'Valor, quanto representa da carteira e quanto variou no período');
    {
      const col = [M, M + 92, M + 122, M + CW];
      cor(COR.fundo, 'f'); doc.rect(M, y - 4, CW, 7, 'F');
      fonte(7.5, 'bold'); cor(COR.suave);
      texto('Investimento', col[0] + 2, y); texto('Valor', col[1] + 20, y, { align: 'right' }); texto('Carteira', col[2] + 12, y, { align: 'right' }); texto('No período', col[3] - 2, y, { align: 'right' });
      y += 7;
      d.contas.forEach((c, i) => {
        if (y > H - 22) { y = novaPagina(); }
        cor(PALETA[i % PALETA.length], 'f'); doc.circle(col[0] + 2.5, y - 1.2, 1.3, 'F');
        fonte(9, 'bold'); cor(COR.tinta); texto(doc.splitTextToSize(T(c.nome), 84)[0], col[0] + 6, y);
        fonte(7); cor(COR.suave); texto(doc.splitTextToSize(T(c.lugar + (c.previa ? ' · cota em prévia' : '')), 84)[0], col[0] + 6, y + 3.8);
        fonte(9); cor(COR.tinta); texto(R(c.valor), col[1] + 20, y, { align: 'right' });
        texto(n1.format(c.share * 100) + '%', col[2] + 12, y, { align: 'right' });
        if (c.conta) { fonte(8); cor(COR.suave); texto('parado', col[3] - 2, y, { align: 'right' }); }
        else if (c.pct != null) {
          fonte(9, 'bold'); cor(c.pct >= 0 ? COR.verde : COR.vermelho); texto(P(c.pct), col[3] - 2, y, { align: 'right' });
          fonte(7); texto(RS(c.v), col[3] - 2, y + 3.8, { align: 'right' });
        } else { fonte(8); cor(COR.suave); texto('0,00%', col[3] - 2, y, { align: 'right' }); }
        doc.setLineWidth(0.2); cor(COR.linha, 'd'); doc.line(M, y + 6, M + CW, y + 6);
        y += 10;
      });
      fonte(9, 'bold'); cor(COR.tinta); texto('Total', col[0] + 6, y); texto(R(d.kpis.patrimonio), col[1] + 20, y, { align: 'right' });
      y += 10;
    }

    // ---------- gastos ----------
    const g = d.gastos;
    if (y > H - 70) y = novaPagina();
    titulo('Gastos no período', g.total > 0 ? 'Total ' + R(g.total) + (g.anterior > 0 ? ' · no período anterior: ' + R(g.anterior) + ' (' + RS(g.total - g.anterior) + ')' : '') : 'Nenhum gasto lançado no período');
    if (g.cats.length) {
      const max = Math.max(...g.cats.map((x) => x.v), 0.01);
      const nomeW = 34, valW = 26, bw = CW - nomeW - valW - 4;
      g.cats.forEach((x) => {
        fonte(8.5); cor(COR.tinta); texto(x.nome, M, y + 2);
        cor(COR.fundo, 'f'); doc.roundedRect(M + nomeW, y - 1.2, bw, 4, 1, 1, 'F');
        cor(COR.ouro, 'f'); doc.roundedRect(M + nomeW, y - 1.2, Math.max(0.8, x.v / max * bw), 4, 1, 1, 'F');
        fonte(8.5, 'bold'); cor(COR.tinta); texto(R(x.v), M + CW, y + 2, { align: 'right' });
        y += 7.5;
      });
      y += 4;
    }

    // ---------- notas ----------
    if (y > H - 40) y = novaPagina();
    fonte(7.5); cor(COR.suave);
    d.notas.forEach((s) => {
      doc.splitTextToSize(T('• ' + s), CW).forEach((l) => { texto(l, M, y); y += 3.8; });
    });
    rodape();
    return doc.output('blob');
  };

  /* ---------- Meus gastos: os últimos meses contra o valor do mês que fica com você ---------- */
  const R0 = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const VAZIO = '—';
  const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));
  const Rn = (v) => (num(v) == null ? VAZIO : R(v));
  // quanto a mais ou a menos foi gasto: gastar mais é vermelho, gastar menos é verde
  const difTxt = (v) => (v == null ? VAZIO : Math.abs(v) < 0.005 ? 'igual' : (v > 0 ? '+ ' : '- ') + brl.format(Math.abs(v)));
  const difCor = (v) => (v == null || Math.abs(v) < 0.005 ? COR.suave : v > 0 ? COR.vermelho : COR.verde);
  const degrau = (bruto) => {
    const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
    return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((f) => f * mag).find((v) => v >= bruto) || 10 * mag;
  };

  window.caixaRelatorioGastosPDF = function (d) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, H = 297, M = 16, CW = W - 2 * M;
    const cor = (c, tipo) => { if (tipo === 'f') doc.setFillColor(c[0], c[1], c[2]); else if (tipo === 'd') doc.setDrawColor(c[0], c[1], c[2]); else doc.setTextColor(c[0], c[1], c[2]); };
    const fonte = (tam, peso) => { doc.setFont('helvetica', peso || 'normal'); doc.setFontSize(tam); };
    const texto = (s, x, y, o) => doc.text(T(s), x, y, o || {});
    const corta = (s, w) => doc.splitTextToSize(T(s), w)[0] || '';
    const CLARO = { ouro: [236, 214, 172], vermelho: [238, 184, 178] };
    const geradoEm = d.geradoEm || new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const meta = Math.max(0, Number(d.meta) || 0);
    const meses = Array.isArray(d.meses) ? d.meses : [];
    const a = d.atual || null;
    const pctMeta = (v) => (meta > 0 ? n1.format((Number(v) || 0) / meta * 100) + '%' : VAZIO);
    let pagina = 1;
    const rodape = () => {
      fonte(7.5); cor(COR.suave);
      texto('Caixa do Leandro · gerado em ' + geradoEm + ' · página ' + pagina, W / 2, H - 8, { align: 'center' });
    };
    const novaPagina = () => { rodape(); doc.addPage(); pagina++; return M + 4; };
    let y = 0;
    const precisa = (h) => { if (y + h > H - 18) y = novaPagina(); };
    const titulo = (s, sub) => {
      fonte(12, 'bold'); cor(COR.tinta); texto(s, M, y);
      if (sub) { fonte(8); cor(COR.suave); texto(sub, M, y + 5); y += 5; }
      y += 6;
    };
    const cabecalho = (cols) => {
      cor(COR.fundo, 'f'); doc.rect(M, y - 4, CW, 7, 'F');
      fonte(7.5, 'bold'); cor(COR.suave);
      cols.forEach(([s, x, al]) => texto(s, x, y, al ? { align: al } : {}));
      y += 7;
    };
    const linhaFina = () => { doc.setLineWidth(0.2); cor(COR.linha, 'd'); doc.line(M, y + 2.5, M + CW, y + 2.5); };

    // ---------- topo ----------
    cor(COR.topo, 'f'); doc.rect(0, 0, W, 34, 'F');
    fonte(19, 'bold'); cor([255, 255, 255]); texto(d.titulo || 'Meus gastos', M, 16);
    fonte(10); doc.setTextColor(200, 225, 214);
    const nomeDe = (m) => (m && (m.nome || m.mes)) || '';
    const periodo = meses.length > 1 ? 'De ' + nomeDe(meses[0]) + ' a ' + nomeDe(meses[meses.length - 1]) : nomeDe(meses[0]);
    texto([periodo, d.ate ? 'até ' + dataBR(d.ate) : '', meta > 0 ? 'meta de ' + R(meta) + ' por mês para você' : 'sem meta do mês definida'].filter(Boolean).join(' · '), M, 24);
    y = 44;

    // ---------- destaques ----------
    const destaques = (Array.isArray(d.destaques) ? d.destaques : []).filter((s) => s != null && String(s).trim());
    if (destaques.length) {
      titulo('Destaques');
      fonte(9);
      const linhas = [];
      destaques.forEach((s) => doc.splitTextToSize(T(s), CW - 12).forEach((l, i) => linhas.push([l, i === 0])));
      const h = linhas.length * 4.6 + 5;
      precisa(h);
      cor(COR.fundo, 'f'); doc.roundedRect(M, y - 3, CW, h, 2.5, 2.5, 'F');
      let yy = y + 2.5;
      linhas.forEach(([l, primeira]) => {
        if (primeira) { cor(COR.ouro, 'f'); doc.circle(M + 5, yy - 1.1, 0.9, 'F'); }
        fonte(9); cor(COR.tinta); texto(l, M + 8, yy);
        yy += 4.6;
      });
      y += h + 7;
    }

    // ---------- gráfico: gastos mês a mês ----------
    if (meses.length) {
      precisa(88);
      titulo('Gastos mês a mês', 'Fixos e variáveis de cada mês' + (meta > 0 ? ', com a linha da meta (' + R(meta) + ')' : ''));
      const gx = M + 16, gw = CW - 16, gh = 56, gy = y + 4;
      const tot = meses.map((m) => Math.max(0, num(m.total) || 0));
      const passo = degrau(Math.max(meta, ...tot, 1) * 1.1 / 4), hi = passo * 4;
      const Y = (v) => gy + gh * (1 - v / hi);
      doc.setLineWidth(0.2); cor(COR.linha, 'd');
      fonte(7); cor(COR.suave);
      for (let g = 0; g <= 4; g++) {
        const v = passo * g, yy = Y(v);
        doc.line(gx, yy, gx + gw, yy);
        texto(R0.format(v), gx - 1.5, yy + 1, { align: 'right' });
      }
      const n = meses.length, slot = gw / n, bw = Math.min(16, slot * 0.55), base = Y(0);
      const centro = (i) => gx + slot * (i + 0.5);
      const acimaDe = (total) => meta > 0 && total > meta + 0.005;
      meses.forEach((m, i) => {
        const cx = centro(i), x0 = cx - bw / 2, total = tot[i];
        const fixos = Math.min(total, Math.max(0, num(m.fixos) || 0));
        const acima = acimaDe(total);
        if (total > 0) {
          cor(acima ? CLARO.vermelho : CLARO.ouro, 'f'); doc.rect(x0, Y(total), bw, base - Y(total), 'F');
          if (fixos > 0) { cor(acima ? COR.vermelho : COR.ouro, 'f'); doc.rect(x0, Y(fixos), bw, base - Y(fixos), 'F'); }
        }
        fonte(7.5); cor(COR.tinta); texto(nomeDe(m), cx, base + 4.5, { align: 'center' });
        if (a && m.mes === a.mes && a.ateDia) { fonte(6.5); cor(COR.suave); texto('até o dia ' + a.ateDia, cx, base + 8, { align: 'center' }); }
      });
      doc.setLineWidth(0.4); doc.setDrawColor(150, 160, 155); doc.line(gx, base, gx + gw, base);
      if (meta > 0) {
        doc.setLineWidth(0.6); cor(COR.tinta, 'd'); doc.setLineDashPattern([1.5, 1.2], 0);
        doc.line(gx, Y(meta), gx + gw, Y(meta)); doc.setLineDashPattern([], 0);
      }
      // valores por cima da linha da meta, com fundo branco para não se misturarem
      fonte(7.5, 'bold');
      tot.forEach((total, i) => {
        const s = T(R(total)), lw = doc.getTextWidth(s) + 1.6, ty = Y(total) - 1.8;
        doc.setFillColor(255, 255, 255); doc.rect(centro(i) - lw / 2, ty - 2.7, lw, 3.5, 'F');
        cor(acimaDe(total) ? COR.vermelho : COR.tinta); texto(s, centro(i), ty, { align: 'center' });
      });
      // legenda
      const ly = base + 14;
      let lx = gx;
      const item = (c, s) => { cor(c, 'f'); doc.rect(lx, ly - 2.6, 3.2, 3.2, 'F'); fonte(8); cor(COR.tinta); texto(s, lx + 4.5, ly); lx += 4.5 + doc.getTextWidth(T(s)) + 7; };
      item(COR.ouro, 'Fixos'); item(CLARO.ouro, 'Variáveis');
      if (meta > 0) {
        item(COR.vermelho, 'Acima da meta');
        doc.setLineWidth(0.6); cor(COR.tinta, 'd'); doc.setLineDashPattern([1.5, 1.2], 0); doc.line(lx, ly - 1.1, lx + 6, ly - 1.1); doc.setLineDashPattern([], 0);
        fonte(8); cor(COR.tinta); texto('Meta ' + R(meta), lx + 7.5, ly);
      }
      y = ly + 11;
    }

    // ---------- quanto sobrou ----------
    if (meses.length) {
      precisa(20 + meses.length * 7);
      titulo('Quanto sobrou', meta > 0 ? 'Meta do mês menos o que foi gasto' + (a && d.ate ? '; o mês atual vai até ' + dataBR(d.ate) : '') : 'Defina em Ajustes quanto fica com você no mês para ver a sobra');
      const c = { fixos: M + 76, variaveis: M + 104, total: M + 132, usado: M + 152, sobra: M + CW - 2 };
      cabecalho([['Mês', M + 2], ['Fixos', c.fixos, 'right'], ['Variáveis', c.variaveis, 'right'], ['Total', c.total, 'right'], ['Da meta', c.usado, 'right'], ['Sobrou', c.sobra, 'right']]);
      meses.forEach((m) => {
        if (y > H - 22) y = novaPagina();
        const total = num(m.total) || 0;
        const sobra = meta > 0 ? (num(m.sobra) != null ? num(m.sobra) : meta - total) : null;
        const atualAqui = a && m.mes === a.mes;
        fonte(9, atualAqui ? 'bold' : 'normal'); cor(COR.tinta);
        texto(nomeDe(m) + (atualAqui && a.ateDia ? ' (até o dia ' + a.ateDia + ')' : ''), M + 2, y);
        fonte(9); texto(Rn(m.fixos), c.fixos, y, { align: 'right' }); texto(Rn(m.variaveis), c.variaveis, y, { align: 'right' });
        fonte(9, 'bold'); texto(R(total), c.total, y, { align: 'right' });
        fonte(9); cor(meta > 0 && total > meta + 0.005 ? COR.vermelho : COR.suave); texto(pctMeta(total), c.usado, y, { align: 'right' });
        fonte(9, 'bold'); cor(sobra == null ? COR.suave : sobra >= 0 ? COR.verde : COR.vermelho);
        texto(sobra == null ? VAZIO : RS(sobra), c.sobra, y, { align: 'right' });
        linhaFina();
        y += 7;
      });
      y += 7;
    }

    // ---------- comparação do mês atual ----------
    if (a) {
      precisa(42);
      const total = num(a.total) || 0;
      const passado = num(a.mesmoPontoMesPassado), media = num(a.mediaAnteriores3);
      const dPassado = passado == null ? null : total - passado, dMedia = media == null ? null : total - media;
      const sobra = meta > 0 ? meta - total : null;
      const dia = a.ateDia ? 'até o dia ' + a.ateDia : 'até agora';
      titulo('Comparação de ' + (a.nome || a.mes || 'este mês'), 'Gasto ' + dia + ' contra o mesmo ponto do mês passado e a média dos 3 meses anteriores');
      const cards = [
        ['Gasto ' + dia, R(total), meta > 0 ? pctMeta(total) + ' da meta' : '', COR.tinta, COR.suave],
        ['Mês passado ' + dia, Rn(passado), passado == null ? 'sem dados para comparar' : difTxt(dPassado) + (Math.abs(dPassado) < 0.005 ? '' : ' este mês'), COR.tinta, difCor(dPassado)],
        ['Média dos 3 anteriores', Rn(media), media == null ? 'sem dados para comparar' : difTxt(dMedia) + (Math.abs(dMedia) < 0.005 ? '' : ' este mês'), COR.tinta, difCor(dMedia)],
        ['Sobra do mês', sobra == null ? VAZIO : RS(sobra), sobra == null ? 'sem meta definida' : sobra >= 0 ? 'ainda dá para gastar' : 'acima da meta', sobra == null ? COR.suave : sobra >= 0 ? COR.verde : COR.vermelho, COR.suave],
      ];
      const gap = 4, cw = (CW - gap * 3) / 4;
      cards.forEach((k, i) => {
        const x = M + i * (cw + gap);
        cor(COR.fundo, 'f'); doc.roundedRect(x, y, cw, 24, 2.5, 2.5, 'F');
        fonte(7.5); cor(COR.suave); texto(corta(k[0], cw - 5), x + 3.5, y + 6);
        fonte(T(k[1]).length > 13 ? 10.5 : 12.5, 'bold'); cor(k[3]); texto(k[1], x + 3.5, y + 13.5);
        fonte(7); cor(k[4]); texto(corta(k[2], cw - 5), x + 3.5, y + 19.5);
      });
      y += 34;
    }

    // ---------- por categoria ----------
    const categorias = Array.isArray(d.categorias) ? d.categorias : [];
    precisa(30);
    titulo('Por categoria' + (a && a.nome ? ' em ' + a.nome : ''), 'Este mês contra a média dos 3 meses anteriores');
    if (categorias.length) {
      const c = { atual: M + 108, media: M + 142, dif: M + CW - 2 };
      cabecalho([['Categoria', M + 2], ['Este mês', c.atual, 'right'], ['Média 3 meses', c.media, 'right'], ['Diferença', c.dif, 'right']]);
      categorias.forEach((k, i) => {
        if (y > H - 22) y = novaPagina();
        const dif = num(k.dif);
        cor(PALETA[i % PALETA.length], 'f'); doc.circle(M + 2.5, y - 1.2, 1.3, 'F');
        fonte(9); cor(COR.tinta); texto(corta(k.nome || k.id || 'Outro', 80), M + 6, y);
        fonte(9, 'bold'); texto(Rn(k.atual), c.atual, y, { align: 'right' });
        fonte(9); cor(COR.suave); texto(Rn(k.media3), c.media, y, { align: 'right' });
        fonte(9, 'bold'); cor(difCor(dif)); texto(difTxt(dif), c.dif, y, { align: 'right' });
        linhaFina();
        y += 7;
      });
      y += 7;
    } else {
      fonte(9); cor(COR.suave); texto('Nenhum gasto neste mês.', M, y); y += 10;
    }

    // ---------- maiores gastos ----------
    const maiores = (Array.isArray(d.maiores) ? d.maiores : []).slice(0, 10);
    precisa(30);
    titulo('Maiores gastos' + (a && a.nome ? ' de ' + a.nome : ' do mês'), maiores.length > 1 ? 'Os ' + maiores.length + ' maiores lançamentos do mês' : '');
    if (maiores.length) {
      const c = { desc: M + 18, cat: M + 112, valor: M + CW - 2 };
      cabecalho([['Data', M + 2], ['Descrição', c.desc], ['Categoria', c.cat], ['Valor', c.valor, 'right']]);
      maiores.forEach((g) => {
        if (y > H - 22) y = novaPagina();
        fonte(9); cor(COR.suave); texto(g.data ? curta(g.data) : VAZIO, M + 2, y);
        cor(COR.tinta); texto(corta(g.descricao || VAZIO, c.cat - c.desc - 4), c.desc, y);
        cor(COR.suave); texto(corta(g.categoria || VAZIO, c.valor - c.cat - 26), c.cat, y);
        fonte(9, 'bold'); cor(COR.tinta); texto(Rn(g.valor), c.valor, y, { align: 'right' });
        linhaFina();
        y += 7;
      });
      y += 6;
    } else {
      fonte(9); cor(COR.suave); texto('Nenhum gasto neste mês.', M, y); y += 10;
    }

    // ---------- notas ----------
    fonte(7.5); cor(COR.suave);
    const notas = [];
    [
      'Meta é o valor do mês que fica com você (Ajustes). Fixos são os gastos fixos do mês, lançados no dia 1º; variáveis, todo o resto.',
      'O mês atual conta os gastos lançados até ' + (d.ate ? dataBR(d.ate) : 'hoje') + '.',
    ].forEach((s) => doc.splitTextToSize(T('• ' + s), CW).forEach((l) => notas.push(l)));
    if (y + notas.length * 3.8 > H - 14) { y = novaPagina(); fonte(7.5); cor(COR.suave); }
    notas.forEach((l) => { texto(l, M, y); y += 3.8; });
    rodape();
    return doc.output('blob');
  };
})();
