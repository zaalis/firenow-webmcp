import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../db/auth';

const MAX_PLAN_BYTES = 100_000;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const row = await env.DB.prepare('SELECT plan_json, status FROM operational_drafts WHERE user_id = ?')
    .bind(user.id).first<{ plan_json: string; status: string }>();
  if (!row) return NextResponse.json({ plan: null, status: null }, { headers: { 'Cache-Control': 'no-store' } });
  try { return NextResponse.json({ plan: JSON.parse(row.plan_json), status: row.status }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Stored draft is invalid.' }, { status: 500 }); }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  let body: { plan?: unknown; status?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!body.plan || typeof body.plan !== 'object' || Array.isArray(body.plan)) return NextResponse.json({ error: 'A plan object is required.' }, { status: 400 });
  const planJson = JSON.stringify(body.plan);
  if (planJson.length > MAX_PLAN_BYTES) return NextResponse.json({ error: 'Plan is too large.' }, { status: 413 });
  const status = body.status === 'review' ? 'review' : 'draft';
  await env.DB.prepare('INSERT INTO operational_drafts (user_id, plan_json, status, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET plan_json = excluded.plan_json, status = excluded.status, updated_at = excluded.updated_at')
    .bind(user.id, planJson, status, Date.now()).run();
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  await env.DB.prepare('DELETE FROM operational_drafts WHERE user_id = ?').bind(user.id).run();
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
