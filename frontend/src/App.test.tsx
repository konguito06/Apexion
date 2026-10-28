import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('exposes the active page and supports the mobile navigation with Escape', async () => {
    provideResizeObserver();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url.endsWith('/api/seasons') ? { seasons: [2024] }
        : url.endsWith('/api/health') ? { status: 'ok' }
          : url.includes('/api/events') ? { events: [] } : {};
      return new Response(JSON.stringify(payload), { status: 200 });
    }));
    render(<App />);
    expect((await screen.findByRole('button', { name: 'Overview' })).getAttribute('aria-current')).toBe('page');
    const menu = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(menu);
    expect(screen.getByRole('button', { name: 'Close navigation' }).getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Open navigation' }).getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Race Explorer' }));
    expect(screen.getByRole('button', { name: 'Race Explorer' }).getAttribute('aria-current')).toBe('page');
  });

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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const changedPit = url.endsWith('/api/simulations') && JSON.parse(String(init?.body)).pit_laps[0] === 30;
      const optimizerRun = url.endsWith('/api/strategies/optimise');
      const optimizerPace = optimizerRun ? Number(JSON.parse(String(init?.body)).baseline_pace_seconds) : 90;
      const simulation = {
        total_seconds: changedPit ? 5349 : 5350, pit_stops: 1, pit_loss_seconds: 22, green_flag_seconds: 5328, baseline_total_seconds: 5350, baseline_description: 'No-stop baseline', delta_vs_baseline_seconds: 0, explanations: ['Compound choices changed modeled pace by 0.000 s.', 'Stint resets changed tyre-age degradation by 0.000 s.', '1 pit stop(s) add 22.000 s at 22.000 s each.', 'Estimated total is 0.000 s versus baseline.'],
        stints: [{ start_lap: 1, end_lap: 20, laps: 20, compound: 'MEDIUM', estimated_seconds: 1810, baseline_pace_contribution_seconds:1800, compound_adjustment_seconds:7, degradation_seconds:3, green_flag_seconds:1810, pit_loss_after_seconds:22 }, { start_lap: 21, end_lap: 58, laps: 38, compound: 'HARD', estimated_seconds: 3540, baseline_pace_contribution_seconds:3420, compound_adjustment_seconds:28, degradation_seconds:92, green_flag_seconds:3540, pit_loss_after_seconds:0 }], pit_stop_details: [],
        lap_curve: [{lap:1,seconds:91,compound:'MEDIUM',tyre_age:0}], assumptions: { baseline_pace_seconds:optimizerPace, degradation_seconds_per_lap_of_tyre_age:.075, pit_loss_seconds_per_stop:22, compound_adjustments_seconds:{SOFT:0,MEDIUM:.35,HARD:.75} }, strategy:{race_laps:58,pit_laps:[20],compounds:['MEDIUM','HARD']},
      };
      const payload = url.endsWith('/api/health') ? { status: 'ok' } : url.includes('/api/events?') ? { events: [] } : optimizerRun ? { results:[simulation],evaluated:1,candidate_space_size:1,candidate_limit:5000,pit_lap_grid_step:1,minimum_stint_laps:4,max_stops:2,exhaustive_within_constraints:true,search_description:'Test bounded search.' } : simulation;
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /strategy simulator/i }));
    fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));
    expect(await screen.findByText('Strategy outcome')).toBeTruthy();
    expect(screen.getByText('89:10.000')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/pit-stop lap/i), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /run simulation/i }));
    expect(await screen.findByText('89:09.000')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /save to comparison/i }));
    fireEvent.change(screen.getByLabelText(/base pace/i), { target: { value: '91' } });
    fireEvent.click(screen.getByRole('button', { name: /find candidates/i }));
    expect(await screen.findByText(/Evaluated 1 of 1 candidates/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    fireEvent.click(screen.getByRole('button', { name: /strategy comparison/i }));
    const optimiserOption = await screen.findByRole('option', { name: /optimiser 2/i });
    expect(await screen.findByRole('heading', { name: 'Strategy comparison' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/baseline \/ model group/i), { target: { value: (optimiserOption as HTMLOptionElement).value } });
    expect(await screen.findByText(/Selected model group · 58 laps · pace 91\.00/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
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
    expect(await screen.findByText('Example Grand Prix · 2024')).toBeTruthy();
    expect(await screen.findByText('Driver A')).toBeTruthy();
    expect(await screen.findByText('91.200 s')).toBeTruthy();
  });

  it('selects a historical session, loads telemetry and compares two laps through the app shell', async () => {
    provideResizeObserver();
    const laps = [1,2].map(lap => ({ lap, seconds:90+lap, sector_1:30, sector_2:30, sector_3:30, compound:'MEDIUM', tyre_life:lap, stint:1, pit_in:false, pit_out:false }));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url=String(input);
      let payload:unknown={};
      if(url.endsWith('/api/health')) payload={status:'ok'};
      else if(url.endsWith('/api/seasons')) payload={seasons:[2024]};
      else if(url.includes('/api/events')) payload={events:[{name:'Example Grand Prix',round:1,sessions:['Practice 1','Race']}]};
      else if(url.includes('/summary')) payload={year:2024,event:'Example Grand Prix',session:'Race',date:'2024-03-02',drivers:['AAA','BBB'],race_laps:2,lap_observations:4,pit_stops:0,compounds:['MEDIUM'],classification:[],data_source:'FastF1 historical data',status:'loaded'};
      else if(url.includes('/laps')) payload={laps};
      else if(url.includes('/telemetry/compare')) payload={data_source:'FastF1 historical telemetry',coordinate:'distance_m',channels:['Speed','Throttle','Brake'],lap_time_delta_seconds:1.2,sector_time_deltas_seconds:{sector_1:.4,sector_2:.1,sector_3:.7},points:[{distance_m:0,first_Speed:100,second_Speed:90,first_Throttle:20,second_Throttle:20,first_Brake:1,second_Brake:1,time_delta_seconds:0},{distance_m:100,first_Speed:200,second_Speed:180,first_Throttle:95,second_Throttle:90,first_Brake:0,second_Brake:0,time_delta_seconds:1}]};
      else if(url.includes('/telemetry?')) payload={data_source:'FastF1 historical telemetry',points:[{Distance:0,Speed:100,Throttle:20,Brake:1,nGear:3,RPM:7000,DRS:0,time_seconds:0},{Distance:100,Speed:200,Throttle:95,Brake:0,nGear:5,RPM:11000,DRS:1,time_seconds:10}]};
      return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
    }));
    render(<App/>);
    expect(await screen.findByText('FastF1 historical data')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:/telemetry lab/i}));
    await waitFor(()=>expect((screen.getByRole('button',{name:'Load telemetry'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'Load telemetry'}));
    expect(await screen.findByRole('heading',{name:'Speed · km/h'})).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox',{name:'Compare two laps'}));
    await waitFor(()=>expect((screen.getByRole('button',{name:'Load telemetry'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'Load telemetry'}));
    expect(await screen.findByRole('heading',{name:/Relative time delta/})).toBeTruthy();
    expect(screen.getByText('+1.200 s')).toBeTruthy();
  });
});
