import { NextResponse } from 'next/server';
import {
  checkRateLimit, clearLoginFailures, createSession, findUser, recordLoginFailure,
  requestIp, validateCsrf, verifyPassword,
} from '../../../../db/auth';

export async function POST(request: Request) {
  if (!(await validateCsrf(request))) return NextResponse.json({ error: 'Invalid CSRF token.' }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request data.' }, { status: 400 });
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string' || email.length > 254 || password.length > 128) {
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
  }
  const ip = requestIp(request);
  const limit = await checkRateLimit(email, ip);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.', retryAfterSeconds: limit.retryAfterSeconds }, {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSeconds), 'Cache-Control': 'no-store' },
    });
  }
  const user = await findUser(email);
  const valid = user ? await verifyPassword(password, user.password_hash) : false;
  if (!user || !valid) {
    await recordLoginFailure(email, ip);
    return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  await clearLoginFailures(email, ip);
  await createSession(user.id);
  return NextResponse.json({ ok: true, email: user.email }, { headers: { 'Cache-Control': 'no-store' } });
}
