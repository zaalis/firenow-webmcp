import FireNowClient from './firenow-client';
import type { InitialToolCall } from './agent-bridge';
import Landing from './landing';
import { getSessionUser } from '../db/auth';

export const dynamic = 'force-dynamic';

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/* `/?tool=NAME&args=JSON` is the invocation surface for an agent whose only
   verb is "open this URL". Resolving it here rather than in the browser lets
   the bridge render already open, on the call it is about to run: the server
   and the client agree on the first paint. */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, params] = await Promise.all([getSessionUser(), searchParams]);
  if (!user) return <Landing />;
  const tool = single(params.tool);
  const initialCall: InitialToolCall | null = tool ? { name: tool, args: single(params.args) || '{}' } : null;
  return <FireNowClient userEmail={user.email} initialCall={initialCall} />;
}
