import fc from 'fast-check';
import { normalizePlate, PLATE_FORMAT } from './normalize-plate';

describe('normalizePlate (CLAUDE.md, principle 8)', () => {
  it.each([
    ['а123вс', 'A123BC'], // Cyrillic lower case
    ['А123ВС', 'A123BC'], // Cyrillic upper case
    ['A123BC', 'A123BC'],
    ['a123bc', 'A123BC'],
    ['A 123 BC', 'A123BC'],
    ['a-123-bc', 'A123BC'],
    ['\tа123вс  ', 'A123BC'], // tabs and non-breaking spaces
    ['Ам 123 Вс', 'AM123BC'], // mixed alphabets
    ['ЕКМНОРСТУХ01', 'EKMHOPCTYX01'], // every look-alike letter
  ])('%j → %s', (raw, expected) => {
    expect(normalizePlate(raw)).toBe(expected);
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['Cyrillic letter without a Latin twin', 'Ж123ВС'],
    ['Cyrillic Ё', 'Ё123'],
    ['punctuation', 'A123.BC'],
    ['emoji', 'A123🚗'],
    ['ß (upper-cases to two letters)', 'Aß123'],
    ['dotless ı (upper-cases to I)', 'Aı123'],
    ['too long', 'A'.repeat(16)],
  ])('rejects %s', (_case, raw) => {
    expect(normalizePlate(raw)).toBeNull();
  });

  it('is idempotent and always yields the stored format', () => {
    const chars = fc.constantFrom(
      ...'ABCEHKMOPTXYZ0123456789abcxyzАВЕКМНОРСТУХавекмнорстух -'.split(''),
    );
    fc.assert(
      fc.property(fc.array(chars, { maxLength: 20 }), (parts) => {
        const once = normalizePlate(parts.join(''));
        if (once === null) return;
        expect(once).toMatch(PLATE_FORMAT);
        expect(normalizePlate(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });
});
