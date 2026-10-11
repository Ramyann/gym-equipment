import { useEffect } from 'react';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { startAccount, useAccount, retryCloud } from '../cloud/session.ts';
import './account.css';

export default function WorkspaceShell() {
  const account = useAccount(), path = useLocation({ select: location => location.pathname });
  useEffect(() => { void startAccount(); }, [startAccount]);
  if (!account.initialized) return <main className="account-loading" role="status">Opening your workspace…</main>;
  if (account.session && !account.ready && path !== '/account') return <main className="account-loading"><h1>Opening your cloud workspace</h1><p role="status">{account.error || 'Loading your gym designs and equipment…'}</p>{account.error && <><button onClick={() => void retryCloud()}>Retry</button><Link to="/account">Open account</Link></>}</main>;
  return <div key={`${account.session?.user.id ?? 'guest'}:${account.generation}`}>
    {account.recovery && path !== '/account' && <div className="cloud-notice" role="status">Your password recovery link is ready. <Link to="/account">Set a new password →</Link></div>}
    {account.session && account.error && path !== '/account' && <div className="cloud-notice" role="status">{account.error} <Link to="/account">Review sync →</Link></div>}
    <Outlet />
  </div>;
}
