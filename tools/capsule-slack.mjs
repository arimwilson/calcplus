// Prints, per element, the smallest distance from the 106 px capsule edge.
// Usage: node tools/capsule-slack.mjs <project dir>  (after npm run build)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const pw = require('/opt/node22/lib/node_modules/playwright')
const ROOT = process.argv[2]
const server = http.createServer((q, r) => { const p = path.join(ROOT, new URL(q.url, 'http://x').pathname); if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end() } r.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.html') ? 'text/html' : 'image/png' }); fs.createReadStream(p).pipe(r) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const b = await pw.chromium.launch(); const page = await b.newPage({ viewport: { width: 212, height: 520 } })
await page.goto(`http://127.0.0.1:${server.address().port}/test/harness/index.html`); await page.waitForFunction(() => window.__ready)
// The digit page empty, the digit page with a long expression, and the
// operator page.
const LONG = '123456*789012+345678/9876-54321*2'.split('')
for (const seq of [[], LONG, ['ops']]) {
  for (const k of seq) await page.evaluate((k) => window.harness.vm.press(k), k)
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)))
  const res = await page.evaluate(() => {
    const out = {}
    const edge = (x, y) => { // distance inside the 106 capsule
      if (y < 106) return 106 - Math.hypot(x - 106, y - 106)
      if (y > 414) return 106 - Math.hypot(x - 106, y - 414)
      return Math.min(x, 212 - x)
    }
    for (const el of document.querySelectorAll('#screen [id] > .key, #screen [data-type=text][id], #screen .minus, #screen .back')) {
      const rs = []
      if (el.dataset.type === 'text') { const r = document.createRange(); r.selectNodeContents(el); rs.push(...r.getClientRects()) } else rs.push(el.getBoundingClientRect())
      let m = Infinity
      for (const r of rs) {
        const R = el.dataset.type === 'div' ? Math.min(parseFloat(getComputedStyle(el).borderRadius) || 0, r.width / 2, r.height / 2) : 0
        for (let i = 0; i <= 64; i++) for (const [cx, cy, sx, sy] of [[r.left + R, r.top + R, -1, -1], [r.right - R, r.top + R, 1, -1], [r.left + R, r.bottom - R, -1, 1], [r.right - R, r.bottom - R, 1, 1]]) {
          const a = (i / 64) * Math.PI / 2; m = Math.min(m, edge(cx + sx * R * Math.cos(a), cy + sy * R * Math.sin(a)))
        }
      }
      out[(el.id || el.parentElement.id || el.className) + (el.dataset.type === 'text' ? ' "' + el.textContent + '"' : '')] = Math.round(m * 10) / 10
    }
    return Object.entries(out).sort((a, b) => a[1] - b[1]).slice(0, 5)
  })
  console.log(res)
}
await b.close(); server.close()
