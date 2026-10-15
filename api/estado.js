import { json, falha, exigirLogin, lerEstado } from './_lib.js';

// GET /api/estado → todos os dados do app (precisa estar logado)
// GET /api/estado?diag=1 → só diz se a configuração está certa, sem mostrar dados
export async function GET(request) {
  const url = new URL(request.url);
  if (url.searchParams.has('diag')) {
    const diag = {
      senha: !!process.env.APP_PASSWORD,
      segredo: !!process.env.APP_SECRET || 'derivado da senha',
      blob: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
      cron: !!process.env.CRON_SECRET,
    };
    try {
      const { salvo } = await lerEstado();
      diag.leitura = 'ok';
      diag.dadosSalvos = salvo;
    } catch (e) {
      diag.leitura = 'falhou';
      console.error(e);
    }
    return json(diag);
  }
  try {
    exigirLogin(request);
    const { estado } = await lerEstado();
    return json({ cols: estado.cols || {}, atualizadoEm: estado.atualizadoEm || null });
  } catch (e) {
    return falha(e);
  }
}
