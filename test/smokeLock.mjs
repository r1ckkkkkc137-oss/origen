// Lock global de smokes (/tmp/origen-smoke.lock): uno a la vez en la box para que no compitan por CPU.
// mkdir es atómico; guarda el pid y roba el lock si su dueño murió o lleva >5 min.
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync } from 'node:fs';
const LOCK = process.env.SMOKE_LOCK || '/tmp/origen-smoke.lock';
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export async function acquireSmokeLock({ timeoutMs = 600000 } = {}) {
  const t0 = Date.now();
  for (;;) {
    try { mkdirSync(LOCK); writeFileSync(`${LOCK}/pid`, String(process.pid)); break; } catch {
      let pid = 0; try { pid = Number(readFileSync(`${LOCK}/pid`, 'utf8')); } catch {}
      let age = 0; try { age = Date.now() - statSync(LOCK).mtimeMs; } catch {}
      if ((pid && !alive(pid)) || age > 300000) { try { rmSync(LOCK, { recursive: true, force: true }); } catch {} continue; }
      if (Date.now() - t0 > timeoutMs) throw new Error(`smoke lock ocupado: ${LOCK} (pid ${pid})`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const release = () => { try { if (Number(readFileSync(`${LOCK}/pid`, 'utf8')) === process.pid) rmSync(LOCK, { recursive: true, force: true }); } catch {} };
  process.on('exit', release);
  return release;
}
