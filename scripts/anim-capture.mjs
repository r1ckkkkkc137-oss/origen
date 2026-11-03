// Captura headless (Chrome + swiftshader). Uso: node scripts/capture.mjs [outDir]  -> PNGs + contact sheets
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { simulate } from '../src/anim/scenarios.js';

const OUT = process.argv[2] || '/workspace/origen-shots/anim-r1';
fs.mkdirSync(OUT, { recursive: true });
const CAMS = ['front', 'side', 'top34'];
const W = 440, H = 400;

// escenas: [nombre del escenario, etiqueta, tiempos[], tiempos "clave" para PNG individual]
const range = (a, b, n) => Array.from({ length: n }, (_, i) => +(a + ((b - a) * i) / (n - 1)).toFixed(3));
function plan() {
  const P = [];
  P.push({ sc: 'guard', label: 'guard', times: [0.6, 1.3, 2.0, 2.7, 3.4], keys: [2.0] });
  P.push({ sc: 'walk', label: 'walk', times: range(3.0, 3.7, 8), keys: [3.0, 3.175, 3.35, 3.525] });
  const j0 = 1.5; P.push({ sc: 'jab', label: 'jab', times: [j0 - 0.05, j0 + 0.06, j0 + 0.10, j0 + 0.152, j0 + 0.22, j0 + 0.30, j0 + 0.40, j0 + 0.55],
    keys: [j0 + 0.06, j0 + 0.152, j0 + 0.26] , keyNames: ['anticipation', 'impact', 'recoil'] });
  // pasos sobre el bloque: buscar el primer plant sobre el bloque alto
  for (const [sc, hMin] of [['step', 0.3], ['step1m', 0.6]]) {
    let tp = 0; simulate(sc, { onFrame: (t, sk, A) => { for (const e of A.events) if (e.type === 'plant' && e.pos[1] > hMin && !tp) tp = t; } });
    const t0 = tp - 0.55;
    P.push({ sc, label: sc, times: range(t0, tp + 0.35, 8), keys: [tp - 0.35, tp - 0.02, tp + 0.30], keyNames: ['swing_up', 'plant_on_block', 'after'] });
  }
  P.push({ sc: 'turn90', label: 'turn90', times: [1.4, 1.55, 1.7, 1.85, 2.0, 2.2, 2.6, 3.2], keys: [1.7, 2.2] });
  return P;
}

const server = await createServer({ configFile: false, root: path.resolve('.'), server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });
await page.goto('http://127.0.0.1:5199/viewer/index.html?capture=1', { waitUntil: 'load' });
await page.waitForFunction('window.CAP');
const save = (name, dataUrl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
const sheetPage = await browser.newPage();
await sheetPage.goto('about:blank');

for (const p of plan()) {
  const allTimes = [...new Set([...p.times, ...p.keys])];
  const res = await page.evaluate((sc, times, cams, w, h) => window.CAP.run(sc, times, cams, w, h), p.sc, allTimes, CAMS, W, H);
  // PNG individuales
  p.keys.forEach((t, k) => { const i = allTimes.indexOf(t); const nm = p.keyNames ? p.keyNames[k] : 't' + t.toFixed(2);
    for (const c of CAMS) save(`${p.label}_${nm}_${c}.png`, res[c][i]); });
  // contact sheets: global (filas = cámaras) y una por cámara (4 columnas)
  const mk = (camList, perRow, scale, label) => sheetPage.evaluate(async (res, times, allTimes, cams, perRow, cw, ch, label) => {
    const rowsPer = Math.ceil(times.length / perRow);
    const cv = document.createElement('canvas'); cv.width = cw * perRow; cv.height = 22 + ch * rowsPer * cams.length; const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height); g.font = '14px monospace'; g.fillStyle = '#9fb0d0'; g.fillText(label, 6, 15);
    for (let r = 0; r < cams.length; r++) for (let k = 0; k < times.length; k++) {
      const i = allTimes.indexOf(times[k]); const img = new Image(); img.src = res[cams[r]][i]; await img.decode();
      const col = k % perRow, row = r * rowsPer + Math.floor(k / perRow);
      g.drawImage(img, col * cw, 22 + row * ch, cw, ch); g.fillStyle = '#ffd24d'; g.fillText(cams[r][0] + ' t=' + times[k].toFixed(2), col * cw + 6, 22 + row * ch + 16);
    }
    return cv.toDataURL('image/png');
  }, res, p.times, allTimes, camList, perRow, Math.round(W * scale), Math.round(H * scale), label);
  save(`sheet_${p.label}.png`, await mk(CAMS, p.times.length, 0.5, `${p.sc} (filas: ${CAMS.join(' / ')})`));
  for (const c of CAMS) save(`sheet_${p.label}_${c}.png`, await mk([c], 4, 0.9, `${p.sc} cámara ${c}`));
  console.log('ok', p.sc, allTimes.length, 'frames');
}
// fps de render (swiftshader, NO representativo de GPU)
await browser.close(); await server.close();
