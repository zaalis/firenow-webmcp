import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../db/auth';

const MAX_PLAN_BYTES = 100_000;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const row = await env.DB.prepare('SELECT plan_json, status, revision FROM operational_drafts WHERE user_id = ?')
    .bind(user.id).first<{ plan_json: string; status: string; revision: number }>();
  if (!row) return NextResponse.json({ plan: null, status: null, revision: null }, { headers: { 'Cache-Control': 'no-store' } });
  try { return NextResponse.json({ plan: JSON.parse(row.plan_json), status: row.status, revision: row.revision }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'Stored draft is invalid.' }, { status: 500 }); }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  let body: { plan?: unknown; status?: unknown; expectedRevision?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!body.plan || typeof body.plan !== 'object' || Array.isArray(body.plan)) return NextResponse.json({ error: 'A plan object is required.' }, { status: 400 });
  if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) return NextResponse.json({ error: 'A non-negative expectedRevision is required.' }, { status: 400 });
  const planJson = JSON.stringify(body.plan);
  if (planJson.length > MAX_PLAN_BYTES) return NextResponse.json({ error: 'Plan is too large.' }, { status: 413 });
  const status = body.status === 'review' ? 'review' : 'draft';
  const expectedRevision = Number(body.expectedRevision);
  const existing = await env.DB.prepare('SELECT revision FROM operational_drafts WHERE user_id = ?').bind(user.id).first<{ revision: number }>();
  if (!existing) {
    if (expectedRevision !== 0) return NextResponse.json({ error: 'Draft changed.', code: 'revision_conflict', revision: null }, { status: 409 });
    await env.DB.prepare('INSERT INTO operational_drafts (user_id, plan_json, status, revision, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind(user.id, planJson, status, 1, Date.now()).run();
    return NextResponse.json({ ok: true, revision: 1 }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const update = await env.DB.prepare('UPDATE operational_drafts SET plan_json = ?, status = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?')
    .bind(planJson, status, Date.now(), user.id, expectedRevision).run();
  if (!update.meta.changes) return NextResponse.json({ error: 'Draft changed.', code: 'revision_conflict', revision: existing.revision }, { status: 409 });
  return NextResponse.json({ ok: true, revision: expectedRevision + 1 }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  await env.DB.prepare('DELETE FROM operational_drafts WHERE user_id = ?').bind(user.id).run();
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
