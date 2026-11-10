// Captura headless (Chrome + swiftshader). Uso: node scripts/capture.mjs [outDir]  -> PNGs + contact sheets
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { simulate } from '../src/anim/scenarios.js';

const OUT = process.argv[2] || '/workspace/origen-shots/anim-r5';
fs.mkdirSync(OUT, { recursive: true });
const CAMS = ['front', 'side', 'top34'];
const W = 440, H = 400;

// escenas: [nombre del escenario, etiqueta, tiempos[], tiempos "clave" para PNG individual]
const range = (a, b, n) => Array.from({ length: n }, (_, i) => +(a + ((b - a) * i) / (n - 1)).toFixed(3));
function plan() {
  const P = [];
  P.push({ sc: 'guard', label: 'guard', times: [0.6, 1.3, 2.0, 2.7, 3.4], keys: [2.0] });
  P.push({ sc: 'walk', label: 'walk', times: range(3.0, 3.7, 8), keys: [3.0, 3.175, 3.35, 3.525] });
  // ronda 4: tiempos de la sim (impactT jab 0.100, cross 0.150, hook 0.183, lowkick 0.233; hit-stop +0.042)
  for (const [sc, imp, ts] of [['jab', 0.10, [-0.05, 0.03, 0.07, 0.10, 0.14, 0.20, 0.26, 0.32]], ['cross', 0.15, [-0.05, 0.05, 0.10, 0.15, 0.19, 0.25, 0.32, 0.43]],
    ['hook', 0.1833, [-0.05, 0.05, 0.12, 0.1833, 0.225, 0.28, 0.36, 0.48]], ['lowkick', 0.2333, [-0.05, 0.06, 0.14, 0.2333, 0.275, 0.36, 0.46, 0.60]]]) {
    P.push({ sc, label: sc, times: ts.map((x) => +(1.5 + x).toFixed(4)), keys: [+(1.5 + ts[2]).toFixed(4), +(1.5 + imp).toFixed(4), +(1.5 + ts[5]).toFixed(4)], keyNames: ['load', 'impact', 'recoil'] });
  }
  P.push({ sc: 'feint_hook', label: 'feint_hook', times: [1.45, 1.53, 1.56, 1.60, 1.63, 1.68, 1.75, 1.88], keys: [1.56, 1.63, 1.75], keyNames: ['shared', 'load_cut', 'back'] });
  P.push({ sc: 'feintSwitch', label: 'feint_switch', times: [1.45, 1.53, 1.567, 1.60, 1.63, 1.68, 1.75, 1.88], keys: [1.63], keyNames: ['load_cut'] });
  for (const [lb, t0] of [['hurt_head_weak', 1.0], ['hurt_head_strong', 2.5], ['hurt_body_weak', 4.0], ['hurt_body_strong', 5.5]]) P.push({ sc: 'hurtForce', label: lb, times: [-0.05, 0.04, 0.08, 0.12, 0.18, 0.26, 0.40, 0.60].map((x) => +(t0 + x).toFixed(3)), keys: [+(t0 + 0.10).toFixed(3)], keyNames: ['peak'] });
  P.push({ sc: 'footwork', label: 'footwork_stepin', times: [0.98, 1.03, 1.07, 1.11, 1.16, 1.22, 1.30, 1.40], keys: [1.11, 1.30], keyNames: ['root_stop', 'planted'] });
  P.push({ sc: 'footwork', label: 'footwork_stepout', times: [1.88, 1.93, 1.97, 2.01, 2.06, 2.12, 2.20, 2.30], keys: [2.06] });
  P.push({ sc: 'footwork', label: 'footwork_circle', times: [2.8, 3.0, 3.2, 3.4, 3.6, 3.8, 4.0, 4.3], keys: [3.4] });
  P.push({ sc: 'block', label: 'block', times: [0.9, 1.05, 1.15, 1.3, 1.5, 1.7, 1.9, 2.3], keys: [1.3] });
  // pasos sobre el bloque: buscar el primer plant sobre el bloque alto
  for (const [sc, hMin] of [['step', 0.3], ['step1m', 0.6]]) {
    let tp = 0; simulate(sc, { onFrame: (t, sk, A) => { for (const e of A.events) if (e.type === 'plant' && e.pos[1] > hMin && !tp) tp = t; } });
    const t0 = tp - 0.55;
    P.push({ sc, label: sc, times: range(t0, tp + 0.35, 8), keys: [tp - 0.35, tp - 0.02, tp + 0.30], keyNames: ['swing_up', 'plant_on_block', 'after'] });
  }
  for (const [lb, t0] of [['hurt_head', 1.0], ['hurt_body', 2.5], ['hurt_legs', 4.0]]) P.push({ sc: 'hurt', label: lb, times: [-0.05, 0.04, 0.08, 0.14, 0.22, 0.32, 0.44, 0.60].map((x) => +(t0 + x).toFixed(3)), keys: [t0 + 0.08, t0 + 0.22] , keyNames: ['peak', 'hold'] });
  P.push({ sc: 'rocked', label: 'rocked', times: [0.9, 1.15, 1.4, 1.8, 2.1, 2.6, 3.3, 4.2], keys: [1.4, 2.1] });
  P.push({ sc: 'ko', label: 'ko', times: [0.98, 1.10, 1.22, 1.32, 1.42, 1.60, 1.84, 2.4], keys: [1.22, 1.42, 1.84, 2.4], keyNames: ['buckle', 'kneel', 'topple', 'lying'] });
  P.push({ sc: 'ko', label: 'getup', times: [3.0, 3.3, 3.6, 3.85, 4.1, 4.35, 4.6, 5.0], keys: [3.6, 4.1] });
  P.push({ sc: 'climb1m', label: 'climb1m', times: [0.1, 0.4, 0.75, 1.05, 1.3, 1.55, 1.8, 2.15].map((x) => +(3.6 + x).toFixed(3)), keys: [3.6 + 0.4, 3.6 + 1.05, 3.6 + 1.55], keyNames: ['grab', 'knee', 'push'] });
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

const ONLY = process.argv[3] ? process.argv[3].split(',') : null;   // p.ej. node scripts/anim-capture.mjs out guard,jab
for (const p of plan()) {
  if (ONLY && !ONLY.includes(p.label)) continue;
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
