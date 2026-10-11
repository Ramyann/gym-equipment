import { Link } from '@tanstack/react-router';
import { cloudConfigured, useAccount } from '../cloud/session.ts';

export function CloudStatus({ compact = false }: { compact?: boolean }) {
  const account = useAccount();
  const label = !account.session ? 'Saved on this device' : account.sync === 'saved' ? 'Saved to cloud' : account.sync === 'syncing' || account.sync === 'pending' ? 'Saving to cloud…' : account.sync === 'conflict' ? 'Sync conflict · Review' : account.sync === 'opening' ? 'Opening cloud…' : 'Saved locally · Sync needs attention';
  return <Link className={compact ? 'cloud-status compact' : 'cloud-status'} to="/account" aria-label={`Account: ${label}`}>
    <span className="cloud-status-dot" data-state={account.sync}/><span>{label}</span>{!account.session && cloudConfigured && <strong>Sign in</strong>}
  </Link>;
}
