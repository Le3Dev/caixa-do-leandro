import { json, falha, autorizado, ErroPedido } from './_lib.js';
import { INDICES, PERIODOS, ErroDeFonte, buscarCotacaoDoIndice, buscarResumoDosIndices } from './_indices.js';
import { buscarDestaquesDaSemana } from './_destaques.js';

// Índices de mercado ao vivo (precisa estar logado).
// GET /api/indices?id=ibovespa&periodo=YTD   → gráfico de um índice no período
// GET /api/indices?lista=resumo              → último valor e variação do dia de todos
// GET /api/indices?lista=destaques-semana    → ações do Ibovespa que mais caíram/subiram na semana

const CABECALHOS = { 'cache-control': 'private, max-age=30' };

export async function GET(request) {
  if (!autorizado(request)) return json({ erro: 'login' }, 401);
  try {
    const params = new URL(request.url).searchParams;
    const lista = params.get('lista');
    if (lista === 'resumo') return json(await buscarResumoDosIndices(), 200, CABECALHOS);
    if (lista === 'destaques-semana') {
      let destaques;
      try {
        destaques = await buscarDestaquesDaSemana({ limite: 10 });
      } catch (e) {
        console.error('destaques da semana', e);
        throw new ErroPedido('Não consegui montar os destaques da semana agora. Tente de novo em alguns minutos.', 502);
      }
      return json(destaques, 200, CABECALHOS);
    }
    if (lista) throw new ErroPedido('Lista desconhecida. Use lista=resumo ou lista=destaques-semana.');

    const id = (params.get('id') || '').trim().toLowerCase();
    const periodo = (params.get('periodo') || '').trim().toUpperCase();
    if (!id) throw new ErroPedido('Informe o índice (id): ' + INDICES.map((i) => i.id).join(', ') + '.');
    const idx = INDICES.find((i) => i.id === id);
    if (!idx) throw new ErroPedido('Índice desconhecido. Use um destes: ' + INDICES.map((i) => i.id).join(', ') + '.');
    if (!periodo) throw new ErroPedido('Informe o período: ' + PERIODOS.join(', ') + '.');
    if (!PERIODOS.includes(periodo)) throw new ErroPedido('Período inválido. Use um destes: ' + PERIODOS.join(', ') + '.');

    try {
      return json(await buscarCotacaoDoIndice(id, periodo), 200, CABECALHOS);
    } catch (e) {
      console.error('índice ' + id + ' ' + periodo, (e && e.detalhes) || e);
      throw new ErroPedido(e instanceof ErroDeFonte ? e.message : 'Não consegui buscar o ' + idx.nome + ' agora. Tente de novo em alguns minutos.', 502);
    }
  } catch (e) {
    return falha(e);
  }
}
