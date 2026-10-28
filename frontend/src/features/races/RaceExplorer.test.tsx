import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {requestMock}=vi.hoisted(()=>({requestMock:vi.fn()}));
vi.mock('../../api',()=>({request:requestMock}));
import { RaceExplorer } from './RaceExplorer';

afterEach(()=>{cleanup();vi.resetAllMocks();});

function provideResizeObserver() {
  class ResizeObserverMock {
    constructor(private callback:ResizeObserverCallback){}
    observe(target:Element){this.callback([{target,contentRect:{width:640,height:260}} as ResizeObserverEntry],this as unknown as ResizeObserver);}
    unobserve(){}
    disconnect(){}
  }
  vi.stubGlobal('ResizeObserver',ResizeObserverMock);
}

const lap=(number:number,seconds:number,pit=false)=>({lap:number,seconds,sector_1:30,sector_2:30,sector_3:seconds-60,compound:'MEDIUM',tyre_life:number,stint:1,pit_in:pit,pit_out:false});
const summary={year:2024,event:'Example GP',session:'Race',date:'2024-01-01',drivers:['AAA','BBB'],race_laps:2,lap_observations:4,pit_stops:1,compounds:['MEDIUM'],classification:[{driver:'AAA',name:'Driver A',team:'A',position:1,grid:1,status:'Finished',points:25,time:181},{driver:'BBB',name:'Driver B',team:'B',position:2,grid:2,status:'Finished',points:18,time:183}],data_source:'FastF1 historical data',status:'loaded'};

describe('RaceExplorer',()=>{
  it('adds a second driver trace and routes the selected driver to analysis and simulation',async()=>{
    provideResizeObserver();
    requestMock.mockResolvedValue({laps:[lap(1,92),lap(2,91)]});
    const onOpenDriverAnalysis=vi.fn();
    const onOpenSimulator=vi.fn();
    render(<RaceExplorer summary={summary} driver="AAA" setDriver={vi.fn()} laps={[lap(1,91),lap(2,90)]} event="Example GP" year={2024} session="Race" loading={false} onOpenDriverAnalysis={onOpenDriverAnalysis} onOpenSimulator={onOpenSimulator}/>);

    fireEvent.change(screen.getByLabelText('Add comparison'),{target:{value:'BBB'}});
    fireEvent.click(screen.getByRole('button',{name:/add/i}));
    await waitFor(()=>expect(document.querySelector('.race-legend')?.textContent).toContain('BBB'));
    await waitFor(()=>expect(requestMock).toHaveBeenCalledWith(expect.stringContaining('driver=BBB')));
    fireEvent.click(screen.getAllByRole('button',{name:/analyze/i})[0]);
    fireEvent.click(screen.getByRole('button',{name:/simulate this race/i}));
    expect(onOpenDriverAnalysis).toHaveBeenCalledOnce();
    expect(onOpenSimulator).toHaveBeenCalledOnce();
  });

  it('filters visible lap detail by an inclusive range',()=>{
    provideResizeObserver();
    render(<RaceExplorer summary={summary} driver="AAA" setDriver={vi.fn()} laps={[lap(1,91),lap(2,90)]} event="Example GP" year={2024} session="Race" loading={false} onOpenDriverAnalysis={vi.fn()} onOpenSimulator={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('Lap from'),{target:{value:'2'}});
    expect(document.querySelector('.lap-detail-list')?.textContent).not.toContain('Lap 1');
    expect(document.querySelector('.lap-detail-list')?.textContent).toContain('Lap 2');
  });
});
