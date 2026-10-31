import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TrackMap } from './TrackMap';

afterEach(cleanup);

// A circular lap where the first driver is quicker on the first half and the second on the rest.
const lap = Array.from({ length: 49 }, (_, index) => {
  const angle = index / 48 * Math.PI * 2;
  return {
    distance_m: index * 100, x: Math.cos(angle) * 1000, y: Math.sin(angle) * 1000, first_Speed: 200, Speed: 150 + index,
    first_elapsed_seconds: index <= 24 ? index : 24 + (index - 24) * 1.2,
    second_elapsed_seconds: index <= 24 ? index * 1.1 : 26.4 + (index - 24),
    X: Math.cos(angle) * 1000, Y: Math.sin(angle) * 1000,
  };
});
const drivers = { first: { label: 'AAA · Lap 1', color: '#3671c6' }, second: { label: 'BBB · Lap 1', color: '#e8002d' } };

describe('TrackMap', () => {
  it('splits mini-sectors between the two compared drivers', () => {
    render(<TrackMap points={lap} compare {...drivers}/>);
    expect(screen.getByRole('heading', { name: 'Who is faster where' })).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Track map: AAA · Lap 1 fastest in 12 and BBB · Lap 1 fastest in 12 of 24 mini-sectors');
  });

  it('shows a speed map for a single lap', () => {
    render(<TrackMap points={lap} compare={false} {...drivers}/>);
    expect(screen.getByRole('heading', { name: 'Speed around the lap' })).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('from 150 to 198 km/h');
  });

  it('renders nothing when the lap has no position data', () => {
    const { container } = render(<TrackMap points={[{ distance_m: 0 }, { distance_m: 1 }]} compare {...drivers}/>);
    expect(container.innerHTML).toBe('');
  });
});
