import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';
import { getSessionUser } from '../../../db/auth';

const MAX_SIMULATION_BYTES = 500_000;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const row = await env.DB.prepare('SELECT simulation_json FROM operational_simulations WHERE user_id = ?')
    .bind(user.id).first<{ simulation_json: string }>();
  if (!row) return NextResponse.json({ simulation: null }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    return NextResponse.json({ simulation: JSON.parse(row.simulation_json) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Stored simulation is invalid.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  let body: { simulation?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  if (!body.simulation || typeof body.simulation !== 'object' || Array.isArray(body.simulation)) {
    return NextResponse.json({ error: 'A simulation object is required.' }, { status: 400 });
  }
  const simulationJson = JSON.stringify(body.simulation);
  if (simulationJson.length > MAX_SIMULATION_BYTES) return NextResponse.json({ error: 'Simulation is too large.' }, { status: 413 });
  const result = await env.DB.prepare('INSERT INTO operational_simulations (user_id, simulation_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET simulation_json = excluded.simulation_json, updated_at = excluded.updated_at')
    .bind(user.id, simulationJson, Date.now()).run();
  if (result.success === false) return NextResponse.json({ error: 'Simulation could not be saved.' }, { status: 500 });
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
