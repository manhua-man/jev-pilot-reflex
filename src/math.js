export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const mix = (a, b, t) => a + (b - a) * t;
export const round = (v, n = 2) => Number(v.toFixed(n));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const heading = (a, b) => Math.atan2(b.x - a.x, a.z - b.z);
export const move = (p, h, d) => ({
  x: p.x + Math.sin(h) * d,
  z: p.z - Math.cos(h) * d,
});
export function rng(seed) {
  let a = Number(seed) >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const choose = (r, a) => a[Math.floor(r() * a.length)];
export function nearestOnPath(p, points, hint = 0) {
  if (!points || points.length === 0) return { distance: Infinity, index: 0, t: 0, x: 0, z: 0, s: 0 };
  let best = { distance: Infinity, index: 0, t: 0, x: 0, z: 0, s: 0 };
  
  let hIndex = 0;
  if (hint > 0) {
    let low = 0, high = points.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (points[mid].s < hint) low = mid + 1;
      else high = mid - 1;
    }
    hIndex = clamp(low, 0, points.length - 1);
  }

  const start = hIndex > 0 ? Math.max(0, hIndex - 30) : 0;
  const end = hIndex > 0 ? Math.min(points.length - 1, hIndex + 120) : points.length - 1;

  for (let i = start; i < end; i++) {
    const a = points[i],
      b = points[i + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x,
      dz = b.z - a.z,
      l2 = dx * dx + dz * dz;
    const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (l2 || 1), 0, 1),
      x = a.x + dx * t,
      z = a.z + dz * t,
      d = Math.hypot(p.x - x, p.z - z);
    if (d < best.distance)
      best = {
        distance: d,
        index: i,
        t,
        x,
        z,
        s: a.s + Math.sqrt(l2) * t,
        heading: heading(a, b),
      };
  }
  if (hIndex > 0 && best.distance <= 6) return best;
  if (hIndex > 0) {
    for (let i = 0; i < points.length - 1; i++) {
      if (i >= start && i < end) continue;
      const a = points[i],
        b = points[i + 1];
      if (!a || !b) continue;
      const dx = b.x - a.x,
        dz = b.z - a.z,
        l2 = dx * dx + dz * dz;
      const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (l2 || 1), 0, 1),
        x = a.x + dx * t,
        z = a.z + dz * t,
        d = Math.hypot(p.x - x, p.z - z);
      if (d < best.distance)
        best = {
          distance: d,
          index: i,
          t,
          x,
          z,
          s: a.s + Math.sqrt(l2) * t,
          heading: heading(a, b),
        };
    }
  }
  return best;
}
export function pointAt(points, s) {
  if (s <= 0) return points[0];
  if (s >= points.at(-1).s) return points.at(-1);
  let lo = 0,
    hi = points.length - 1;
  while (lo + 1 < hi) {
    const m = (lo + hi) >> 1;
    if (points[m].s < s) lo = m;
    else hi = m;
  }
  const a = points[lo],
    b = points[hi],
    t = (s - a.s) / (b.s - a.s);
  return {
    x: mix(a.x, b.x, t),
    z: mix(a.z, b.z, t),
    s,
    heading: heading(a, b),
  };
}
export function samplePolyline(raw, spacing = 1) {
  if (!raw || raw.length === 0) return [];
  const h0 = raw.length > 1 ? heading(raw[0], raw[1]) : 0;
  const pts = [{ ...raw[0], s: 0, heading: h0 }];
  let s = 0;
  for (let i = 1; i < raw.length; i++) {
    const a = raw[i - 1],
      b = raw[i],
      d = dist(a, b),
      h = heading(a, b),
      n = Math.max(1, Math.ceil(d / spacing));
    for (let k = 1; k <= n; k++) {
      s += d / n;
      pts.push({ x: mix(a.x, b.x, k / n), z: mix(a.z, b.z, k / n), s, heading: h });
    }
  }
  return pts;
}
export function blockedByBuilding(a, b, buildings, exclude) {
  for (const o of buildings) {
    if (o.id === exclude) continue;
    let tmin = 0.015,
      tmax = 0.985;
    for (const axis of ["x", "z"]) {
      const d = b[axis] - a[axis],
        r = o[axis === "x" ? "width" : "depth"] / 2;
      if (Math.abs(d) < 1e-6) {
        if (a[axis] < o[axis] - r || a[axis] > o[axis] + r) {
          tmin = 2;
          break;
        }
      } else {
        let t1 = (o[axis] - r - a[axis]) / d,
          t2 = (o[axis] + r - a[axis]) / d;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
      }
    }
    if (tmax >= tmin) return true;
  }
  return false;
}
