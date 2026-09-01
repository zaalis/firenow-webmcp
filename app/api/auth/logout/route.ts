import { NextResponse } from 'next/server';
import { deleteSession, validateCsrf } from '../../../../db/auth';

export async function POST(request: Request) {
  if (!(await validateCsrf(request))) return NextResponse.json({ error: 'Invalid CSRF token.' }, { status: 403 });
  await deleteSession();
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
