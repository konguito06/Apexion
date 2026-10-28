import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('API error handling', () => {
  it('uses the FastAPI detail for a structured error response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Session unavailable' }), { status: 503 })));

    await expect(request('/api/sessions')).rejects.toThrow('Session unavailable');
  });

  it('returns a useful message when a proxy responds with non-JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 })));

    await expect(request('/api/sessions')).rejects.toThrow('Apexion API request failed (502).');
  });

  it('explains when the backend cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));

    await expect(request('/api/health')).rejects.toThrow('Cannot reach Apexion API. Check that the backend is running, then retry.');
  });
});
