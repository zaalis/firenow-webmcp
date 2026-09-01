import { NextResponse } from 'next/server';
import {
  createSession, createUser, findUser, hashPassword, isPwnedPassword, validateCsrf,
} from '../../../../db/auth';

export async function POST(request: Request) {
  if (!(await validateCsrf(request))) return NextResponse.json({ error: 'Invalid CSRF token.' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request data.' }, { status: 400 });
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    return NextResponse.json({ error: 'Password must be between 12 and 128 characters.' }, { status: 400 });
  }
  if (await findUser(email)) return NextResponse.json({ error: 'An account already uses this address.' }, { status: 409 });
  if (await isPwnedPassword(password)) return NextResponse.json({ error: 'This password appears in a known breach. Choose another one.' }, { status: 400 });
  try {
    const user = await createUser(email, await hashPassword(password));
    await createSession(user.id);
    return NextResponse.json({ ok: true, email: user.email }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    console.error('FireNow registration failed', cause);
    return NextResponse.json({ error: 'Could not create the account.' }, { status: 500 });
  }
}
