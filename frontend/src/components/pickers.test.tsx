import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DriverSelect } from './DriverSelect';
import { LapSelect } from './LapSelect';
import { DriverInfoContext, buildDriverInfo } from '../drivers';

afterEach(cleanup);

const info = buildDriverInfo([
  { driver:'VER', name:'Max Verstappen', team:'Red Bull Racing', number:'1', headshot_url:null, team_color:'#3671c6', country_code:'NED' },
  { driver:'LEC', name:'Charles Leclerc', team:'Ferrari', number:'16', headshot_url:null, team_color:'#e8002d', country_code:'MON' },
  { driver:'NOR', name:'Lando Norris', team:'McLaren', number:'4', headshot_url:null, team_color:null, country_code:'GBR' },
]);

describe('DriverSelect', () => {
  it('shows the driver identity and picks with the mouse', () => {
    const onChange = vi.fn();
    render(<DriverInfoContext.Provider value={info}><DriverSelect label="Driver" drivers={['VER','LEC','NOR']} value="VER" onChange={onChange}/></DriverInfoContext.Provider>);
    const trigger = screen.getByRole('combobox', { name:'Driver' });
    expect(trigger.textContent).toContain('Max Verstappen');
    fireEvent.click(trigger);
    expect(screen.getByRole('option', { name:/LEC/ }).textContent).toContain('Ferrari');
    fireEvent.click(screen.getByRole('option', { name:/LEC/ }));
    expect(onChange).toHaveBeenCalledWith('LEC');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('supports arrow keys, type-ahead, Enter and Escape', () => {
    const onChange = vi.fn();
    render(<DriverInfoContext.Provider value={info}><DriverSelect label="Driver" drivers={['VER','LEC','NOR']} value="VER" onChange={onChange}/></DriverInfoContext.Provider>);
    const trigger = screen.getByRole('combobox', { name:'Driver' });
    fireEvent.keyDown(trigger, { key:'ArrowDown' });
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(trigger, { key:'ArrowDown' });
    fireEvent.keyDown(trigger, { key:'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('LEC');
    fireEvent.keyDown(trigger, { key:'ArrowDown' });
    fireEvent.keyDown(trigger, { key:'n' });
    fireEvent.keyDown(trigger, { key:'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('NOR');
    fireEvent.keyDown(trigger, { key:'ArrowDown' });
    fireEvent.keyDown(trigger, { key:'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('LapSelect', () => {
  const laps = [
    { lap:1, seconds:95, compound:'SOFT', pit_in:false, pit_out:false },
    { lap:2, seconds:91.5, compound:'SOFT', pit_in:false, pit_out:false },
    { lap:3, seconds:90, compound:'HARD', pit_in:true, pit_out:false },
  ];

  it('labels laps with time and tyre and jumps to the fastest racing lap', () => {
    const onChange = vi.fn();
    render(<LapSelect label="Lap" laps={laps} value={1} onChange={onChange}/>);
    expect(screen.getByRole('option', { name:'Lap 2 · 1:31.500 · SOFT · FASTEST' })).toBeTruthy();
    expect(screen.getByRole('option', { name:'Lap 3 · 1:30.000 · HARD · PIT IN' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name:/Fastest/ }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
