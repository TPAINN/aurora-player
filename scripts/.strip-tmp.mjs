import { chromium } from 'playwright-core';
import { readFileSync, readdirSync } from 'node:fs';
const [dir, prefix, out, w] = process.argv.slice(2);
const files = readdirSync(dir).filter(f => f.startsWith(prefix)).sort();
const imgs = files.map((f, i) => `<figure><img src="data:image/png;base64,${readFileSync(`${dir}/${f}`).toString('base64')}"><figcaption>${i * 55 + 'ms'}</figcaption></figure>`).join('');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 7 * (+w + 6), height: 300 } });
await page.setContent(`<style>body{margin:0;background:#000;display:grid;grid-template-columns:repeat(7,${w}px);gap:6px;font:11px sans-serif;color:#fff}img{width:${w}px;display:block}figure{margin:0}</style>${imgs}`);
await page.screenshot({ path: out, fullPage: true }); await browser.close();
