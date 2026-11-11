import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AccountGate } from './AccountGate';
import { useAccount } from './account';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); sessionStorage.clear(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const signedOut = { available: true, signed_in: false, expires_at: null };
const signedIn = { available: true, signed_in: true, expires_at: 2_000_000_000 };

function Workspace() {
  const account = useAccount();
  return <div>Workspace {account?.signedIn ? 'signed in' : 'guest'}</div>;
}

describe('F1 account gate', () => {
  it('asks for an F1 sign-in before opening the app and sends the credentials once', async () => {
    const fetch = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>(async url => json(url.endsWith('/sign-in') ? signedIn : signedOut));
    vi.stubGlobal('fetch', fetch);

    render(<AccountGate><Workspace/></AccountGate>);

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'fan@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    expect(screen.queryByText(/Workspace/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Workspace signed in')).toBeTruthy();
    const [, options] = fetch.mock.calls.find(([url]) => url.endsWith('/sign-in'))!;
    expect(JSON.parse(String(options?.body))).toEqual({ username: 'fan@example.com', password: 'secret' });
  });

  it('shows the F1 rejection and keeps the form open', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/sign-in')
      ? json({ detail: 'There was a problem with your password or email address.' }, 401)
      : json(signedOut)));

    render(<AccountGate><Workspace/></AccountGate>);
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'fan@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect((await screen.findByRole('alert')).textContent).toContain('password or email address');
    expect(screen.queryByText(/Workspace/)).toBeNull();
  });

  it('opens straight away when a stored sign-in is still valid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(signedIn)));

    render(<AccountGate><Workspace/></AccountGate>);

    expect(await screen.findByText('Workspace signed in')).toBeTruthy();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  it('lets the app open without an account for this tab', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(signedOut)));

    render(<AccountGate><Workspace/></AccountGate>);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue without signing in' }));

    expect(await screen.findByText('Workspace guest')).toBeTruthy();
  });
});
