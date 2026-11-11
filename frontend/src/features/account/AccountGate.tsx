import { useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { request } from '../../api';
import { AccountContext } from './account';
import type { Account, AccountStatus } from './account';

// Skipping sign-in lasts for this browser tab only, so the next visit asks again.
const SKIP_KEY = 'apexion.f1-sign-in.skipped';

function readSkipped(){try{return sessionStorage.getItem(SKIP_KEY)==='1';}catch{return false;}}
function writeSkipped(skipped:boolean){try{if(skipped)sessionStorage.setItem(SKIP_KEY,'1');else sessionStorage.removeItem(SKIP_KEY);}catch{/* storage unavailable: skipping still applies until reload */}}

export function AccountGate({children}:{children:ReactNode}){
  const [status,setStatus]=useState<AccountStatus|null>(null);
  const [checked,setChecked]=useState(false);
  const [skipped,setSkipped]=useState(readSkipped);

  useEffect(()=>{request<AccountStatus>('/api/account').then(setStatus).catch(()=>setStatus(null)).finally(()=>setChecked(true));},[]);

  if(!checked)return null;
  // Without a reachable API or FastF1 there is nothing to sign in to; the app reports that itself.
  const needsSignIn=status?.available===true&&!status.signed_in&&!skipped;
  if(needsSignIn)return <SignIn onSignedIn={next=>{writeSkipped(false);setStatus(next);}} onSkip={()=>{writeSkipped(true);setSkipped(true);}}/>;

  const account:Account|null=status?.available?{
    signedIn:status.signed_in,
    signOut:()=>{request<AccountStatus>('/api/account/sign-out',{method:'POST'}).then(next=>{writeSkipped(false);setSkipped(false);setStatus(next);}).catch(()=>undefined);},
    signIn:()=>{writeSkipped(false);setSkipped(false);},
  }:null;
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

function SignIn({onSignedIn,onSkip}:{onSignedIn:(status:AccountStatus)=>void;onSkip:()=>void}){
  const [username,setUsername]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  async function submit(event:FormEvent){
    event.preventDefault();
    setBusy(true);setError('');
    try{
      onSignedIn(await request<AccountStatus>('/api/account/sign-in',{method:'POST',body:JSON.stringify({username,password})}));
    }catch(e){
      setError(e instanceof Error?e.message:'Sign-in failed.');
      setBusy(false);
    }
  }

  return <main className="account-gate">
    <form className="panel account-card" onSubmit={submit} aria-labelledby="account-title">
      <div className="brand account-brand"><svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path className="brand-tile" d="M8 1h23l-8 30H0z"/><path d="M6.5 25.5 16 6.5l5 19"/><path className="brand-line" d="M8.8 19.4c4.4-3.2 9.6-3.5 15.2-1"/></svg><div><b>APEX<span>ION</span></b><small>RACE INTELLIGENCE</small></div></div>
      <div className="eyebrow">FORMULA 1 ACCOUNT</div>
      <h1 id="account-title">Sign in to F1</h1>
      <p>The F1 timing feed needs an account with an active F1 TV subscription. Your password is passed to Formula 1 once; Apexion keeps only the sign-in token on this computer.</p>
      {error&&<div className="alert" role="alert">{error}</div>}
      <label className="field">Email<input type="email" autoComplete="username" required value={username} onChange={e=>setUsername(e.target.value)}/></label>
      <label className="field">Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      <button type="submit" className="primary account-submit" disabled={busy}><LogIn size={14} aria-hidden="true"/>{busy?'Signing in…':'Sign in'}</button>
      <button type="button" className="text-link account-skip" onClick={onSkip}>Continue without signing in</button>
    </form>
  </main>;
}
