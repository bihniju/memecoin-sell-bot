export const pctChange = (from: number, to: number): number => (from === 0 ? 0 : ((to - from) / from) * 100);
export const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
