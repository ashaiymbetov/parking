/**
 * Plate normalization (CLAUDE.md, principle 8): upper case, no spaces or
 * hyphens, Cyrillic look-alikes → Latin. Pure; returns null for input that
 * cannot be a plate. Output always matches PLATE_FORMAT (the DB CHECK).
 */
export const PLATE_FORMAT = /^[A-Z0-9]{1,15}$/;

/** Cyrillic letters that look exactly like Latin ones on a plate. */
const CYRILLIC_TWINS: Record<string, string> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
};

export function normalizePlate(raw: string): string | null {
  let out = '';
  for (const ch of raw) {
    if (/[\s-]/u.test(ch)) continue;
    if (/[0-9A-Z]/.test(ch)) out += ch;
    else if (/[a-z]/.test(ch)) out += ch.toUpperCase();
    else if (CYRILLIC_TWINS[ch.toUpperCase()])
      out += CYRILLIC_TWINS[ch.toUpperCase()];
    // Anything else (other Cyrillic letters, ß, punctuation, emoji) is not
    // part of a plate; rejecting is safer than guessing.
    else return null;
  }
  return PLATE_FORMAT.test(out) ? out : null;
}
