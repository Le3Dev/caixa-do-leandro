/* Relatório em PDF (semana ou mês), desenhado direto com o jsPDF: números, gráficos e tabela.
   window.caixaRelatorioPDF(dados) devolve um Blob. Os dados vêm já calculados pela tela (index.html). */
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
})();
