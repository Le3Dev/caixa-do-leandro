import { json, senhaConfere, cookieDeSessao, cookieDeSaida } from './_lib.js';

// POST /api/login  { senha }  → grava o cookie da sessão por um ano
export async function POST(request) {
  let senha = '';
  try {
    senha = (await request.json()).senha;
  } catch {
    senha = '';
  }
  if (!senhaConfere(senha)) {
    await new Promise((r) => setTimeout(r, 800)); // atrasa tentativas seguidas
    return json({ erro: 'Senha errada.' }, 401);
  }
  return json({ ok: true }, 200, { 'set-cookie': cookieDeSessao() });
}

// DELETE /api/login → sai
export function DELETE() {
  return json({ ok: true }, 200, { 'set-cookie': cookieDeSaida() });
}
