import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { studioRequest, type StudioSession } from '../cloud/client.ts';
import { cloudConfigured, currentWorkspaceBackup, acceptSession, importGuestWorkspace, resolveCloud, retryCloud, signOut, useAccount } from '../cloud/session.ts';
import { StudioSidebar } from '../components/StudioSidebar.tsx';
import { CloudStatus } from '../components/CloudStatus.tsx';
import './dashboard.css';
import './account.css';

export default function AccountPage() {
  const account = useAccount(), navigate = useNavigate();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const resetToken = typeof search.reset === 'string' ? search.reset : null;
  const verifyToken = typeof search.verify === 'string' ? search.verify : null;
  const recovery = !!resetToken;
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [name, setName] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [backedUp, setBackedUp] = useState(false), [signOutFailed, setSignOutFailed] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The request could not be completed. Try again.'); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (recovery) {
        const result = await studioRequest<{ message: string }>('reset-password', { token: resetToken, password });
        setPassword(''); await acceptSession(null); await navigate({ to: '/account', replace: true }); setMessage(result.message);
      } else if (mode === 'signup') {
        const data = await studioRequest<{ user: StudioSession['user'] | null; message?: string }>('signup', { email: email.trim(), password, name: name.trim() });
        setPassword('');
        if (data.user) { await acceptSession({ user: data.user }); await navigate({ to: '/' }); }
        else setMessage('Check your email to confirm your account, then sign in here.');
      } else if (mode === 'reset') {
        await studioRequest('recover', { email: email.trim() });
        setMessage('If an account exists for this email, you’ll receive a password recovery link.');
      } else {
        const data = await studioRequest<StudioSession>('signin', { email: email.trim(), password });
        setPassword(''); await acceptSession(data); await navigate({ to: '/' });
      }
    });
  }
  function backup() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), ...currentWorkspaceBackup() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = 'gym-studio-workspace-backup.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setBackedUp(true);
  }
  async function logout(offline = false) {
    try { await signOut(offline); await navigate({ to: '/' }); }
    catch (reason) { setSignOutFailed(true); throw reason; }
  }
  return <div className="studio-dashboard studio-account"><StudioSidebar active="account"/><main className="studio-main">
    <div className="studio-breadcrumb">Workspace <span>/</span> Account</div>
    <header className="studio-heading"><div><h1>{recovery ? 'Set a new password' : account.session ? 'My account' : 'Your Studio, anywhere'}</h1><p>{account.session ? 'Manage your workspace and cloud saves.' : 'Keep your projects and items together across devices.'}</p></div></header>
    {error && <p className="dashboard-error" role="alert">{error}</p>}
    {message && <p className="dashboard-notice" role="status">{message}</p>}
    {verifyToken && <section className="account-card"><h2>Confirm your email</h2><p>Confirm your email address to open your private Studio workspace.</p><button className="primary" disabled={busy} onClick={() => void run(async () => { const data = await studioRequest<StudioSession>('verify', { token: verifyToken }); await acceptSession(data); await navigate({ to: '/', replace: true }); })}>Confirm email & open Studio</button></section>}
    {!account.session || recovery ? <section className="account-card">
      {!recovery && <div className="account-tabs"><button type="button" aria-pressed={mode === 'signin'} disabled={busy} onClick={() => { setMode('signin'); setError(''); setMessage(''); }}>Sign in</button><button type="button" aria-pressed={mode === 'signup'} disabled={busy} onClick={() => { setMode('signup'); setError(''); setMessage(''); }}>Create account</button></div>}
      {!cloudConfigured && <p className="dashboard-notice" role="status">Cloud accounts are not available in this installation yet. Your Studio designs can still be saved on this device.</p>}
      <form onSubmit={submit}>
        {mode === 'reset' && !recovery && <h2>Recover your password</h2>}
        {mode === 'signup' && !recovery && <label>Your name <small>Optional</small><input value={name} maxLength={100} autoComplete="name" onChange={event => setName(event.target.value)}/></label>}
        {!recovery && <label>Email address<input type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={busy}/></label>}
        {(mode !== 'reset' || recovery) && <label>{recovery ? 'New password' : 'Password'}<input type="password" required minLength={mode === 'signup' || recovery ? 8 : 1} maxLength={128} autoComplete={mode === 'signup' || recovery ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} disabled={busy}/>{(mode === 'signup' || recovery) && <small>Use at least 8 characters.</small>}</label>}
        <button className="primary" disabled={busy || !cloudConfigured}>{busy ? 'Please wait…' : recovery ? 'Update password' : mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send recovery link' : 'Sign in'}</button>
      </form>
      {!recovery && <><button className="account-text-button" disabled={busy} onClick={() => { setMode(mode === 'reset' ? 'signin' : 'reset'); setError(''); setMessage(''); }}>{mode === 'reset' ? 'Back to sign in' : 'Forgot your password?'}</button><button className="account-text-button" disabled={busy || !email.trim()} onClick={() => void run(async () => { await studioRequest('resend', { email: email.trim() }); setMessage('If your email needs confirmation, a new link is on its way.'); })}>Resend confirmation email</button><Link to="/">Continue on this device →</Link></>}
    </section> : <>
      <section className="account-card"><span className="eyebrow">YOUR ACCOUNT</span><h2>{account.session.user.name || 'Space Studio'}</h2><p>{account.session.user.email}</p><CloudStatus/>
        {account.error && <p className="dashboard-error" role="alert">{account.error}</p>}
        <div className="account-actions"><button className="secondary" disabled={busy} onClick={() => void run(retryCloud)}>Sync now</button><button className="secondary" disabled={busy || !account.ready} onClick={backup}>Download workspace backup</button><button className="secondary" disabled={busy} onClick={() => void run(() => logout())}>Sign out</button></div>
        {signOutFailed && <div className="dashboard-notice"><p>Your cached edits stay on this device for this account. Sign out now and sync them when you return.</p><button disabled={busy} onClick={() => void run(() => logout(true))}>Sign out and keep local edits</button></div>}
      </section>
      {account.sync === 'conflict' && <section className="account-card"><h2>Resolve your sync conflict</h2><p>Your local workspace and the cloud workspace differ. Download your local backup first, then choose the version you want to keep.</p><button className="secondary" disabled={busy} onClick={backup}>Download local backup</button><div className="account-actions"><button className="secondary" disabled={busy || !backedUp} onClick={() => void run(async () => { await resolveCloud('cloud'); await navigate({ to: '/' }); })}>Use cloud version</button><button className="secondary" disabled={busy || !backedUp} onClick={() => void run(async () => { await resolveCloud('local'); await navigate({ to: '/' }); })}>Replace cloud with local version</button></div><small>Using the cloud version replaces this device’s copy. Replacing cloud uses your local workspace across devices.</small></section>}
      <section className="account-card"><h2>Bring your device designs with you</h2><p>Copy projects and custom items created while signed out into your account. Your existing cloud designs and device originals are preserved.</p><button className="primary" disabled={busy || !account.ready || account.sync === 'conflict'} onClick={() => void run(async () => { const count = await importGuestWorkspace(); setMessage(`Imported ${count.gyms} gyms and ${count.parts} equipment items.`); })}>Import device designs & equipment</button></section>
    </>}
    <p className="account-help">{account.session ? 'Your cloud workspace is private to your account.' : 'You can explore Studio without an account. Device designs are imported only when you choose to copy them.'}</p>
  </main></div>;
}
