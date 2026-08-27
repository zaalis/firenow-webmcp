import FireOpsClient from './fireops-client';
import LoginClient from './login-client';
import { getSessionUser } from '../db/auth';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getSessionUser();
  return user ? <FireOpsClient userEmail={user.email} /> : <LoginClient />;
}
