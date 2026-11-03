// Mide fps del viewer en vivo (Chrome headless + swiftshader = render por CPU: NO representativo de una GPU real).
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
const srv = await createServer({ server: { port: 5198 }, logLevel: 'error' }); await srv.listen();
const br = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const pg = await br.newPage(); await pg.setViewport({ width: 640, height: 400 });
await pg.goto('http://localhost:5198/viewer/index.html?s=walk'); await new Promise((r) => setTimeout(r, 4000));
const fps = await pg.evaluate(() => window.__fps); console.log('fps viewer (swiftshader, 640x400):', fps?.toFixed(1));
await br.close(); await srv.close();
