import FireNowClient from './firenow-client';
import Landing from './landing';
import { getSessionUser } from '../db/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) return <Landing />;
  return <FireNowClient userEmail={user.email} />;
}
