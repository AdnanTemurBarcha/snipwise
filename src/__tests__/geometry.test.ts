import { describe, it, expect } from 'vitest';
import { pointInBox, rotatePoint } from '../studio/engine/geometry';

describe('pointInBox', () => {
  const box = { x: 10, y: 10, width: 20, height: 20, rotation: 0 };
  it('detects points inside', () => {
    expect(pointInBox(box, { x: 15, y: 15 })).toBe(true);
  });
  it('rejects points outside', () => {
    expect(pointInBox(box, { x: 5, y: 5 })).toBe(false);
  });
  it('follows the rotation of the box', () => {
    // a 20x20 box rotated 45deg about its centre (20,20): the old corner area is now empty
    const rotated = { ...box, rotation: Math.PI / 4 };
    expect(pointInBox(rotated, { x: 11, y: 11 })).toBe(false);
    expect(pointInBox(rotated, { x: 20, y: 20 })).toBe(true);
  });
});

describe('rotatePoint', () => {
  it('rotates a quarter turn about a centre', () => {
    const p = rotatePoint({ x: 2, y: 0 }, { x: 0, y: 0 }, Math.PI / 2);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(2);
  });
});
