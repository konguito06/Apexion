import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function provideResizeObserver() {
  class ResizeObserverMock {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 640, height: 260 } } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
}

describe('Apexion navigation', () => {
  it('shows a non-blocking loading status while FastF1 event choices are being retrieved', async () => {
    provideResizeObserver();
    let finishSchedule!: (response: Response) => void;
    const supportedSeasons = Array.from({ length: new Date().getFullYear() - 2017 }, (_, i) => 2018 + i);
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/seasons')) return Promise.resolve(new Response(JSON.stringify({ seasons: supportedSeasons })));
      if (url.endsWith('/api/health')) return Promise.resolve(new Response(JSON.stringify({ status: 'ok' })));
      if (url.includes('/api/events')) return new Promise<Response>(resolve => { finishSchedule = resolve; });
      return Promise.resolve(new Response(JSON.stringify({})));
    }));

    render(<App />);
    expect((await screen.findByRole('status')).textContent).toContain('Loading');
    finishSchedule(new Response(JSON.stringify({ events: [] })));
    expect(await screen.findByText(/No events are available/)).toBeTruthy();
  });

  it('opens the simulator and displays its API result', async () => {
    provideResizeObserver();
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
    fireEvent.click(screen.getByRole('button', { name: /save to comparison/i }));
    fireEvent.click(screen.getByRole('button', { name: /strategy comparison/i }));
    expect(await screen.findByRole('heading', { name: 'Strategy comparison' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByRole('button', { name: /update saved strategy/i })).toBeTruthy();
  });

  it('loads event metadata and renders historical classification and laps', async () => {
    provideResizeObserver();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      let payload: unknown = {};
      if (url.endsWith('/api/health')) payload = { status: 'ok' };
      else if (url.endsWith('/api/seasons')) payload = { seasons: [2024] };
      else if (url.includes('/api/events')) payload = { events: [{ name: 'Example Grand Prix', round: 1, sessions: ['Practice 1', 'Race'] }] };
      else if (url.includes('/summary')) payload = { year: 2024, event: 'Example Grand Prix', session: 'Race', date: '2024-03-02', drivers: ['AAA'], race_laps: 2, lap_observations: 2, pit_stops: 0, compounds: ['MEDIUM'], classification: [{ driver: 'AAA', name: 'Driver A', team: 'Example Team', position: 1, grid: 1, status: 'Finished', points: 25, time: 180 }], data_source: 'FastF1 historical data', status: 'loaded' };
      else if (url.includes('/laps')) payload = { laps: [{ lap: 1, seconds: 91.2, sector_1: 30.1, sector_2: 30.2, sector_3: 30.9, compound: 'MEDIUM', tyre_life: 1, pit_in: false, pit_out: false }] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /race explorer/i }));
    expect(await screen.findByText('Example Grand Prix · Race')).toBeTruthy();
    expect(await screen.findByText('Driver A')).toBeTruthy();
    expect(await screen.findByText('91.200')).toBeTruthy();
  });
});
