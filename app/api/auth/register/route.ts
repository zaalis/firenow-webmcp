import { NextResponse } from 'next/server';
import {
  createSession, createUser, findUser, hashPassword, isPwnedPassword, validateCsrf,
} from '../../../../db/auth';

export async function POST(request: Request) {
  if (!(await validateCsrf(request))) return NextResponse.json({ error: 'Jeton CSRF invalide.' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Données invalides.' }, { status: 400 });
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Adresse email invalide.' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return NextResponse.json({ error: 'Le mot de passe doit contenir entre 12 et 128 caractères.' }, { status: 400 });
  }
  if (await findUser(email)) return NextResponse.json({ error: 'Un compte utilise déjà cette adresse.' }, { status: 409 });
  if (await isPwnedPassword(password)) return NextResponse.json({ error: 'Ce mot de passe figure dans une fuite connue. Choisissez-en un autre.' }, { status: 400 });
  try {
    const user = await createUser(email, await hashPassword(password));
    await createSession(user.id);
    return NextResponse.json({ ok: true, email: user.email }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    console.error('FireOps registration failed', cause);
    return NextResponse.json({ error: 'Création du compte impossible.' }, { status: 500 });
  }
}
