// findFightSpot: busca, de forma determinista, un lugar llano del mundo donde poner el ring (círculo de ~radius bloques).
// `ground` = predicado sólido de celdas enteras en BLOQUES (x,y,z)=>bool, o un objeto con solidAt (World): NO usar getBlock crudo
// (el agua es truthy). Si el objeto también trae getBlock se descartan columnas con agua sobre la superficie.
// Sin azar: espiral fija alrededor de (x,z). Devuelve { origin:[x,y,z] (bloques, centro de celda, y = cara superior del suelo),
//   spread (máx-mín de alturas en el disco), ok (spread<=maxSpread y sin agua), tried }.
const MAX_Y = 63;
const solidFn = (ground) => (typeof ground === 'function' ? ground : (x, y, z) => ground.solidAt(x, y, z));

/** y (bloques) de la CARA SUPERIOR del suelo en la columna (x,z): primera celda sólida desde arriba, +1. -Infinity si no hay. */
export function surfaceTop(ground, x, z, maxY = MAX_Y) {
  const solid = solidFn(ground);
  for (let y = maxY; y >= 0; y--) if (solid(x, y, z)) return y + 1;
  return -Infinity;
}
/** Altura del suelo (bloques, cara superior) cerca de `yHint`: busca hacia abajo desde yHint+3 (saliendo antes de una pared). */
export function groundTopNear(ground, x, z, yHint, up = 3, down = 8) {
  const solid = solidFn(ground);
  let y = Math.floor(yHint) + up;
  for (let k = 0; k < 4 && solid(x, y, z); k++) y++;
  for (let i = 0; i <= up + down + 4; i++, y--) if (y < 0 || solid(x, y, z)) return y + 1;
  return Math.floor(yHint);
}

export function findFightSpot(world, x, z, radius = 6, opts = {}) {
  const search = opts.search ?? 24, step = opts.step ?? 2, maxSpread = opts.maxSpread ?? 1;
  const solid = solidFn(world), getBlock = typeof world === 'object' ? world.getBlock?.bind(world) : null;
  const cache = new Map();
  const col = (cx, cz) => {
    const k = cx * 100003 + cz;   // cx,cz enteros pequeños
    let v = cache.get(k);
    if (v === undefined) {
      const top = surfaceTop(solid, cx, cz);
      const wet = getBlock && top > -Infinity && getBlock(cx, top, cz) !== 0;   // algo no sólido (agua) sobre el suelo
      v = { top, wet: !!wet }; cache.set(k, v);
    }
    return v;
  };
  const r2 = radius * radius;
  const evalAt = (cx, cz) => {
    let lo = Infinity, hi = -Infinity, wet = false, n = 0;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dz * dz > r2) continue;
      const c = col(cx + dx, cz + dz); n++;
      if (c.top === -Infinity) return null;
      if (c.wet) wet = true;
      if (c.top < lo) lo = c.top; if (c.top > hi) hi = c.top;
    }
    // la cota del ring = mediana-baja: la altura del centro si está dentro del rango
    return { spread: hi - lo, wet, y: col(cx, cz).top, n };
  };
  const x0 = Math.floor(x), z0 = Math.floor(z);
  let best = null, tried = 0;
  const consider = (cx, cz) => {
    tried++;
    const e = evalAt(cx, cz); if (!e) return false;
    const ok = e.spread <= maxSpread && !e.wet;
    const score = (e.wet ? 1000 : 0) + e.spread;
    if (!best || score < best.score) best = { score, cx, cz, e, ok };   // empate: gana el primero (el más cercano)
    return ok && e.spread === 0;
  };
  let done = consider(x0, z0);
  for (let r = step; !done && r <= search; r += step) {
    const K = Math.max(6, Math.round((2 * Math.PI * r) / step));
    for (let k = 0; k < K && !done; k++) {
      const a = (2 * Math.PI * k) / K;
      done = consider(x0 + Math.round(r * Math.cos(a)), z0 + Math.round(r * Math.sin(a)));
    }
    if (best && best.ok && r >= search / 2) break;   // sitio aceptable (desnivel <= maxSpread) y ya se miró la mitad del radio: no seguir lejos
  }
  if (!best) return { origin: [x0 + 0.5, 0, z0 + 0.5], spread: Infinity, ok: false, tried };
  return { origin: [best.cx + 0.5, best.e.y, best.cz + 0.5], spread: best.e.spread, ok: best.ok, tried };
}
