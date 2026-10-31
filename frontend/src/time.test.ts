import { describe, expect, it } from 'vitest';
import { formatAxisTime, formatDelta, formatTime } from './time';

describe('formatTime', () => {
  it('shows a minute or more as minutes and seconds', () => {
    expect(formatTime(98.826)).toBe('1:38.826');
    expect(formatTime(60)).toBe('1:00.000');
    expect(formatTime(1800)).toBe('30:00.000');
  });

  it('adds hours for full race distances', () => {
    expect(formatTime(5504.742)).toBe('1:31:44.742');
    expect(formatTime(5228.9, 1)).toBe('1:27:08.9');
  });

  it('keeps sub-minute values in seconds', () => {
    expect(formatTime(31.419)).toBe('31.419 s');
    expect(formatTime(22, 1)).toBe('22.0 s');
  });

  it('rounds before choosing the unit', () => {
    expect(formatTime(59.9996)).toBe('1:00.000');
  });

  it('handles missing values', () => {
    expect(formatTime(null)).toBe('—');
    expect(formatTime(undefined, 3, 'No time')).toBe('No time');
  });
});

describe('formatDelta', () => {
  it('signs gaps and switches to minutes for big ones', () => {
    expect(formatDelta(1.482)).toBe('+1.482 s');
    expect(formatDelta(-0.322)).toBe('-0.322 s');
    expect(formatDelta(74.887)).toBe('+1:14.887');
    expect(formatDelta(0)).toBe('0.000 s');
  });
});

describe('formatAxisTime', () => {
  it('drops the unit for chart ticks', () => {
    expect(formatAxisTime(98.4)).toBe('1:38.4');
    expect(formatAxisTime(31.25)).toBe('31.3');
  });
});
