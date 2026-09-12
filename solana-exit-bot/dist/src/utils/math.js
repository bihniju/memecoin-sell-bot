export const pctChange = (from, to) => (from === 0 ? 0 : ((to - from) / from) * 100);
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
