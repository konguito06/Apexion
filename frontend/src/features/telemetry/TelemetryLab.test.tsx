import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const {requestMock}=vi.hoisted(()=>({requestMock:vi.fn()}));
vi.mock('../../api',()=>({request:requestMock}));
import { TelemetryLab } from './TelemetryLab';

afterEach(()=>{cleanup();vi.resetAllMocks();});

const lap=(number:number)=>({lap:number,seconds:90+number,sector_1:30,sector_2:30,sector_3:30,compound:'MEDIUM',tyre_life:number,pit_in:false,pit_out:false});

function provideResizeObserver() {
  class ResizeObserverMock { observe(){} unobserve(){} disconnect(){} }
  vi.stubGlobal('ResizeObserver',ResizeObserverMock);
}

describe('TelemetryLab',()=>{
  it('loads measured channels then compares laps with time and sector deltas',async()=>{
    provideResizeObserver();
    requestMock.mockImplementation(async(path:string)=>{
      if(path.includes('driver=BBB')) return {laps:[lap(1),lap(2)]};
      if(path.includes('/telemetry?')) return {data_source:'FastF1 historical telemetry',points:[{Distance:0,Speed:100,Throttle:20,Brake:1,nGear:3,RPM:7000,DRS:0,time_seconds:0},{Distance:100,Speed:200,Throttle:95,Brake:0,nGear:5,RPM:11000,DRS:1,time_seconds:10}]};
      if(path.includes('/compare')) return {data_source:'FastF1 historical telemetry',coordinate:'distance_m',channels:['Speed','Throttle','Brake'],lap_time_delta_seconds:1.2,sector_time_deltas_seconds:{sector_1:.4,sector_2:.1,sector_3:.7},points:[{distance_m:0,first_Speed:100,second_Speed:90,first_Throttle:20,second_Throttle:20,first_Brake:1,second_Brake:1,time_delta_seconds:0},{distance_m:100,first_Speed:200,second_Speed:180,first_Throttle:95,second_Throttle:90,first_Brake:0,second_Brake:0,time_delta_seconds:1}]};
      return {laps:[lap(1),lap(2)]};
    });
    render(<TelemetryLab year={2024} event="Example GP" session="Race" drivers={['AAA','BBB']} driver="AAA" setDriver={vi.fn()} laps={[lap(1),lap(2)]} loading={false}/>);

    fireEvent.click(screen.getByRole('button',{name:'Load telemetry'}));
    expect(await screen.findByRole('heading',{name:'Speed · km/h'})).toBeTruthy();
    expect(await screen.findByText(/samples · FastF1 lap distance/)).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox',{name:'Compare two laps'}));
    await waitFor(()=>expect(requestMock).toHaveBeenCalledWith(expect.stringContaining('driver=BBB')));
    fireEvent.click(screen.getByRole('button',{name:'Load telemetry'}));
    expect(await screen.findByRole('heading',{name:/Relative time delta/})).toBeTruthy();
    expect(screen.getByText('+1.200 s')).toBeTruthy();
    expect(screen.getByText('+0.400 s')).toBeTruthy();
  });

  it('does not allow a same-lap self comparison',async()=>{
    provideResizeObserver();
    requestMock.mockResolvedValue({laps:[lap(1)]});
    render(<TelemetryLab year={2024} event="Example GP" session="Race" drivers={['AAA']} driver="AAA" setDriver={vi.fn()} laps={[lap(1)]} loading={false}/>);
    fireEvent.click(screen.getByRole('checkbox',{name:'Compare two laps'}));
    await waitFor(()=>expect((screen.getByRole('button',{name:'Load telemetry'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'Load telemetry'}));
    expect(await screen.findByText(/Choose a different compatible driver\/lap pair/)).toBeTruthy();
    expect(requestMock.mock.calls.some(([path])=>path==='/api/sessions/telemetry/compare')).toBe(false);
  });
});
