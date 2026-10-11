import { Link } from '@tanstack/react-router';
import { CloudStatus } from './CloudStatus.tsx';
import { useAccount } from '../cloud/session.ts';

export function StudioSidebar({ active }: { active: 'designs' | 'equipment' | 'templates' | 'account' }) {
  const account = useAccount();
  return <aside className="studio-sidebar">
    <Link to="/" className="studio-brand"><span>▥</span>Gym planner</Link>
    <nav aria-label="Workspace">
      <Link to="/" className={active === 'designs' ? 'active' : undefined} aria-current={active === 'designs' ? 'page' : undefined}>▦ <span>My gym designs</span></Link>
      <Link to="/library" className={active === 'equipment' ? 'active' : undefined} aria-current={active === 'equipment' ? 'page' : undefined}>◇ <span>My equipment</span></Link>
      <Link to="/gyms" className={active === 'templates' ? 'active' : undefined} aria-current={active === 'templates' ? 'page' : undefined}>▤ <span>Templates</span></Link>
      <Link to="/account" className={active === 'account' ? 'active' : undefined} aria-current={active === 'account' ? 'page' : undefined}>○ <span>{account.session ? 'My account' : 'Sign in'}</span></Link>
    </nav>
    <div className="workspace-note"><strong>{account.session ? 'Cloud workspace' : 'Personal workspace'}</strong><CloudStatus compact/></div>
  </aside>;
}
