import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { useDriverInfo } from '../drivers';
import { DriverAvatar } from './DriverAvatar';

/** Driver picker showing photo, number, name and team colour; keyboard behaviour follows the ARIA select-only combobox pattern. */
export function DriverSelect({label, drivers, value, onChange, disabled = false, placeholder = 'Select driver', hideLabel = false}:{label:string; drivers:string[]; value:string; onChange:(driver:string)=>void; disabled?:boolean; placeholder?:string; hideLabel?:boolean}) {
  const driverInfo = useDriverInfo();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = drivers.includes(value) ? driverInfo(value) : null;
  const unavailable = disabled || !drivers.length;

  useEffect(() => {
    if (!open) return;
    const close = (event:MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block:'nearest' });
  }, [open, active, listId]);

  const show = () => { setActive(Math.max(0, drivers.indexOf(value))); setOpen(true); };
  const choose = (driver:string) => { onChange(driver); setOpen(false); trigger.current?.focus(); };
  const onKeyDown = (event:KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); show(); }
      return;
    }
    const move = (index:number) => { event.preventDefault(); setActive(Math.min(drivers.length - 1, Math.max(0, index))); };
    if (event.key === 'ArrowDown') move(active + 1);
    else if (event.key === 'ArrowUp') move(active - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(drivers.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (drivers[active]) choose(drivers[active]); }
    else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    else if (event.key === 'Tab') setOpen(false);
    else if (event.key.length === 1 && /[a-z]/i.test(event.key)) {
      // Type-ahead: jump to the next driver code starting with the typed letter.
      const letter = event.key.toUpperCase();
      const order = [...drivers.slice(active + 1), ...drivers.slice(0, active + 1)];
      const match = order.find(driver => driver.startsWith(letter));
      if (match) setActive(drivers.indexOf(match));
    }
  };

  return <div className={`picker-field driver-select${open ? ' open' : ''}`} ref={root}>
    {!hideLabel && <span className="picker-label">{label}</span>}
    <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open ? `${listId}-${active}` : undefined}
      className="driver-select-trigger" disabled={unavailable} style={{'--team':current?.color ?? '#3a3e48'} as CSSProperties}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={onKeyDown}>
      {current ? <>
        <DriverAvatar info={current} size={32}/>
        <span className="ds-text"><b>{current.code}{current.number && <em>#{current.number}</em>}</b><small>{current.name ?? current.team ?? 'Driver'}</small></span>
      </> : <span className="ds-placeholder">{drivers.length ? placeholder : 'No drivers loaded'}</span>}
      <ChevronDown size={15} aria-hidden="true" className="ds-chevron"/>
    </button>
    {open && <ul role="listbox" id={listId} aria-label={label} className="driver-select-menu">
      {drivers.map((driver, index) => {
        const info = driverInfo(driver);
        return <li key={driver} id={`${listId}-${index}`} role="option" aria-selected={driver === value} className={index === active ? 'active' : undefined}
          style={{'--team':info.color} as CSSProperties} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(driver)}>
          <DriverAvatar info={info} size={30}/>
          <span className="ds-number">{info.number ?? ''}</span>
          <span className="ds-text"><b>{driver}</b><small>{info.name ?? ''}</small></span>
          <span className="ds-team">{info.team ?? ''}</span>
        </li>;
      })}
    </ul>}
  </div>;
}
