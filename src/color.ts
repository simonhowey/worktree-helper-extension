// Color selection and contrast math. Pure module (no `vscode`), unit-testable.
// We pick a titlebar background that is maximally distinct from the colors
// already used by sibling worktrees, then derive a readable foreground.

export interface TitlebarColors {
  activeBackground: string;
  activeForeground: string;
  inactiveBackground: string;
  inactiveForeground: string;
  border: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) {
    return null;
  }
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function toHex({ r, g, b }: Rgb): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** WCAG relative luminance of an sRGB color. */
function luminance({ r, g, b }: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on `background`. */
export function contrastingForeground(background: string): string {
  const bg = parseHex(background) ?? { r: 0, g: 0, b: 0 };
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  return contrastRatio(bg, white) >= contrastRatio(bg, black)
    ? "#ffffff"
    : "#000000";
}

/** Perceptual-ish distance between two colors ("redmean" approximation). */
function distance(a: Rgb, b: Rgb): number {
  const rmean = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(
    (2 + rmean / 256) * dr * dr +
      4 * dg * dg +
      (2 + (255 - rmean) / 256) * db * db,
  );
}

/** FNV-1a 32-bit string hash — stable across machines, used for deterministic tie-breaks. */
function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return toHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

/** Deterministic background derived from a seed when the palette can't be used. */
export function deterministicColor(seed: string): string {
  const hue = hash(seed) % 360;
  return hslToHex(hue, 0.65, 0.42);
}

/**
 * Picks the palette color most distinct from `used`, breaking ties deterministically
 * by `seed` so a given branch is stable. Prefers unused colors; if all are used,
 * still returns the most-distinct one. Falls back to a deterministic color when the
 * palette is empty.
 */
export function pickDistinctColor(
  palette: string[],
  used: string[],
  seed: string,
): string {
  const candidates = palette
    .map(parseHex)
    .map((rgb, i) => ({ hex: palette[i], rgb }))
    .filter((c) => c.rgb);
  if (candidates.length === 0) {
    return deterministicColor(seed);
  }

  const usedRgb = used.map(parseHex).filter((c): c is Rgb => c !== null);
  const usedSet = new Set(used.map((u) => u.toLowerCase()));
  const unused = candidates.filter((c) => !usedSet.has(c.hex.toLowerCase()));
  const pool = unused.length > 0 ? unused : candidates;

  let best = pool[0];
  let bestScore = -1;
  for (const c of pool) {
    // Distinctness = distance to the nearest already-used color (Infinity if none used).
    const minDist =
      usedRgb.length === 0
        ? Infinity
        : Math.min(...usedRgb.map((u) => distance(c.rgb!, u)));
    // Deterministic, stable jitter in [0,1) so equal-distance candidates resolve the same way.
    const jitter = (hash(seed + c.hex) % 1000) / 1000;
    const score = (minDist === Infinity ? 1e9 : minDist) + jitter;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best.hex;
}

/** Build the full set of titleBar.* values from a chosen background. */
export function buildTitlebarColors(background: string): TitlebarColors {
  const bg = parseHex(background) ?? { r: 0x12, g: 0x12, b: 0x12 };
  // Inactive = background muted toward a neutral gray so unfocused windows are dimmer.
  const activeBackground = toHex(bg);
  return {
    activeBackground,
    activeForeground: contrastingForeground(activeBackground),
    inactiveBackground: activeBackground,
    inactiveForeground: contrastingForeground(activeBackground),
    border: activeBackground,
  };
}
