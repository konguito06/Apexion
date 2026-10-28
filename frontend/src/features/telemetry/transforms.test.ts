import { describe, expect, it } from 'vitest';
import { telemetryRegions } from './transforms';

describe('telemetryRegions', () => {
  it('marks brake and acceleration regions from measured channels', () => {
    const points = [
      {Distance:0,Brake:1,Throttle:0,Speed:80},
      {Distance:10,Brake:1,Throttle:0,Speed:70},
      {Distance:20,Brake:0,Throttle:85,Speed:75},
      {Distance:30,Brake:0,Throttle:95,Speed:90},
    ];

    expect(telemetryRegions(points,'Distance',false)).toEqual([
      {start:0,end:20,kind:'braking'},
      {start:20,end:30,kind:'acceleration'},
    ]);
  });

  it('returns no inferred regions when source channels are absent', () => {
    expect(telemetryRegions([{Distance:0,Speed:50},{Distance:10,Speed:60}],'Distance',false)).toEqual([]);
  });

  it('uses only measured first/second channels in a comparison', () => {
    const points = [
      {distance_m:0,first_Brake:1,second_Brake:0,first_Throttle:10,second_Throttle:10,first_Speed:80,second_Speed:70},
      {distance_m:10,first_Brake:0,second_Brake:0,first_Throttle:90,second_Throttle:90,first_Speed:90,second_Speed:80},
    ];
    expect(telemetryRegions(points,'distance_m',true)).toEqual([
      {start:0,end:10,kind:'braking'},
    ]);
  });
});
