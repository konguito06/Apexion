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

    fireEvent.click(screen.getByRole('combobox',{name:'Add comparison'}));
    fireEvent.click(screen.getByRole('option',{name:/BBB/}));
    await waitFor(()=>expect(document.querySelector('.race-legend')?.textContent).toContain('BBB'));
    await waitFor(()=>expect(requestMock).toHaveBeenCalledWith(expect.stringContaining('driver=BBB')));
    fireEvent.click(screen.getAllByRole('button',{name:/analyze/i})[0]);
    fireEvent.click(screen.getByRole('button',{name:/simulate this race/i}));
    expect(onOpenDriverAnalysis).toHaveBeenCalledOnce();
    expect(onOpenSimulator).toHaveBeenCalledOnce();
  });

  it('filters visible lap detail by an inclusive range',()=>{
    provideResizeObserver();
    requestMock.mockResolvedValue({laps:[]});
    render(<RaceExplorer summary={summary} driver="AAA" setDriver={vi.fn()} laps={[lap(1,91),lap(2,90)]} event="Example GP" year={2024} session="Race" loading={false} onOpenDriverAnalysis={vi.fn()} onOpenSimulator={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('Lap from'),{target:{value:'2'}});
    expect(document.querySelector('.lap-detail-list')?.textContent).not.toContain('Lap 1');
    expect(document.querySelector('.lap-detail-list')?.textContent).toContain('Lap 2');
  });

  it('shows race events, pit stops with pit lane time, and coloured qualifying push laps',async()=>{
    provideResizeObserver();
    const timingLap=(driver:string,number:number,sectors:[number,number,number],extra={})=>({driver,lap:number,seconds:sectors[0]+sectors[1]+sectors[2],sector_1:sectors[0],sector_2:sectors[1],sector_3:sectors[2],compound:'SOFT',tyre_life:number,pit_in:false,pit_out:false,deleted:false,deleted_reason:null,personal_best:false,...extra});
    requestMock.mockImplementation(async(path:string)=>{
      if(path.includes('/race-control')) return {periods:[{kind:'safety_car',start_lap:1,end_lap:2,start_seconds:0,end_seconds:200}],events:[{kind:'safety_car',lap:1,sector:null,message:'SAFETY CAR DEPLOYED',drivers:[]},{kind:'penalty',lap:2,sector:null,message:'FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 1 (AAA) - UNSAFE RELEASE',drivers:['AAA']}],pit_stops:[{driver:'AAA',lap:1,from_compound:'MEDIUM',to_compound:'HARD',pit_lane_seconds:21.633,under:'safety_car'}]};
      if(path.includes('/timing')) return {laps:[timingLap('AAA',2,[30,28.1,28.4]),timingLap('AAA',3,[29.9,28.3,28.6]),timingLap('BBB',2,[30.2,28,28.5])]};
      return {laps:[lap(1,92),lap(2,91)]};
    });
    const {rerender}=render(<RaceExplorer summary={summary} driver="AAA" setDriver={vi.fn()} laps={[lap(1,91),lap(2,90)]} event="Example GP" year={2024} session="Race" loading={false} onOpenDriverAnalysis={vi.fn()} onOpenSimulator={vi.fn()}/>);
    expect(await screen.findByRole('heading',{name:'Race events'})).toBeTruthy();
    expect(screen.getByText(/5 SECOND TIME PENALTY/)).toBeTruthy();
    expect(screen.getByRole('heading',{name:'Pit stops'})).toBeTruthy();
    expect(document.querySelector('.pit-row:not(.pit-head)')?.textContent).toContain('21.633 s');
    expect(document.querySelector('.pit-row:not(.pit-head)')?.textContent).toContain('UNDER SC');

    rerender(<RaceExplorer summary={summary} driver="AAA" setDriver={vi.fn()} laps={[lap(1,91),lap(2,90)]} event="Example GP" year={2024} session="Qualifying" loading={false} onOpenDriverAnalysis={vi.fn()} onOpenSimulator={vi.fn()}/>);
    expect(await screen.findByRole('heading',{name:'Push laps and sectors'})).toBeTruthy();
    const cards=document.querySelectorAll('.push-card');
    expect(cards[0].textContent).toContain('AAA');
    expect(cards[0].querySelectorAll('.timing-purple').length).toBeGreaterThan(0);
    expect(cards[1].querySelector('.push-row:not(.push-head) span.timing-purple')?.textContent).toBe('28.000');
  });
});
