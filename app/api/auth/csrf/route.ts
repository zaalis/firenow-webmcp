import { NextResponse } from 'next/server';
import { issueCsrfToken } from '../../../../db/auth';

export async function GET() {
  return NextResponse.json({ csrfToken: await issueCsrfToken() }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
