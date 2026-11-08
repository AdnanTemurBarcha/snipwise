import { describe, expect, it } from 'vitest';
import { matchesEmoji } from '../studio/ui/emoji-picker';
import { EMOJI_GROUPS } from '../studio/ui/emoji-data';

describe('emoji data', () => {
  const all = EMOJI_GROUPS.flatMap((g) => g.items);
  it('covers the full set across nine groups', () => {
    expect(EMOJI_GROUPS).toHaveLength(9);
    expect(all.length).toBeGreaterThan(1800);
  });
  it('has no duplicates and a name for every glyph', () => {
    expect(new Set(all.map(([e]) => e)).size).toBe(all.length);
    expect(all.every(([, n]) => n.length > 0)).toBe(true);
  });
  it('includes the annotation favourites', () => {
    const glyphs = new Set(all.map(([e]) => e));
    for (const e of ['👍', '✅', '❌', '⚠️', '🚀', '🐛', '🔒']) expect(glyphs.has(e)).toBe(true);
  });
});

describe('matchesEmoji', () => {
  it('matches every word of the query against the name', () => {
    expect(matchesEmoji('🚀', 'rocket', 'rock')).toBe(true);
    expect(matchesEmoji('😀', 'grinning face', 'face grin')).toBe(true);
    expect(matchesEmoji('😀', 'grinning face', 'cat')).toBe(false);
  });
  it('matches a pasted glyph directly', () => {
    expect(matchesEmoji('🚀', 'rocket', '🚀')).toBe(true);
    expect(matchesEmoji('🚀', 'rocket', '🐛')).toBe(false);
  });
  it('an empty query matches everything', () => {
    expect(matchesEmoji('🚀', 'rocket', '  ')).toBe(true);
  });
});
