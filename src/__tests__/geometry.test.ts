import { describe, it, expect } from 'vitest';
import { pointInRect } from '../editor/core/geometry.js';

describe('pointInRect', () => {
  const rect = { x: 10, y: 10, width: 20, height: 20 };
  it('detects points inside', () => {
    expect(pointInRect(15, 15, rect)).toBe(true);
  });
  it('rejects points outside', () => {
    expect(pointInRect(5, 5, rect)).toBe(false);
  });
});
