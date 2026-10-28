import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Apexion navigation', () => {
  it('opens the simulator and displays its API result', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith('/api/health') ? { status: 'ok' } : url.endsWith('/api/events?season=2024') ? { events: [] } : {
        total_seconds: 5350, pit_stops: 1, pit_loss_seconds: 22, green_flag_seconds: 5328,
        stints: [{ start_lap: 1, end_lap: 20, laps: 20, compound: 'MEDIUM', estimated_seconds: 1810 }, { start_lap: 21, end_lap: 58, laps: 38, compound: 'HARD', estimated_seconds: 3540 }],
        lap_curve: [], assumptions: { source: 'Illustrative deterministic baseline; not fitted to a race.' },
      };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /strategy simulator/i }));
    fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));
    expect(await screen.findByText('Strategy outcome')).toBeTruthy();
    expect(screen.getByText('89:10.000')).toBeTruthy();
  });
});
