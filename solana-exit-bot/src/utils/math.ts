const MAX_FINITE = Number.MAX_VALUE;

export const finiteOr = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

export const safeMultiply = (a: number, b: number): number => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return Number.isNaN(a * b) ? 0 : Math.sign(a * b) * MAX_FINITE;
  }

  const result = a * b;
  return Number.isFinite(result) ? result : Math.sign(result) * MAX_FINITE;
};

export const safeSubtract = (a: number, b: number): number => {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return Number.isNaN(a - b) ? 0 : Math.sign(a - b) * MAX_FINITE;
  }

  const result = a - b;
  return Number.isFinite(result) ? result : Math.sign(result) * MAX_FINITE;
};

export const pctChange = (from: number, to: number): number => {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return 0;
  return finiteOr(safeMultiply(safeSubtract(to, from) / from, 100));
};

export const clamp = (n: number, min: number, max: number): number =>
  Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
