// UI tests: drive the compiled page (build/) in headless Chromium through
// test/harness. Run `npm run build` first.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let playwright
try {
  playwright = require('playwright')
} catch {
  playwright = require('/opt/node22/lib/node_modules/playwright')
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = path.join(ROOT, 'test', 'screens')
const STORE = 'st:band-calc-state'

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' }
let server, base, browser

test.before(async () => {
  if (!fs.existsSync(path.join(ROOT, 'build', 'pages', 'index', 'index.js'))) {
    throw new Error('build/ missing: run `npm run build` first')
  }
  fs.mkdirSync(SHOTS, { recursive: true })
  server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      res.writeHead(404)
      return res.end()
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' })
    fs.createReadStream(p).pipe(res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
  browser = await playwright.chromium.launch()
})

test.after(async () => {
  await browser?.close()
  server?.close()
})

// Key ids for the characters used in tap sequences. O and D flip to the
// operator and digit pages; keys() also flips by itself when a key isn't on
// the page showing.
const KEY_ID = {
  '0': 'k-0', '1': 'k-1', '2': 'k-2', '3': 'k-3', '4': 'k-4', '5': 'k-5', '6': 'k-6', '7': 'k-7', '8': 'k-8', '9': 'k-9',
  '=': 'k-eq', O: 'k-ops',
  '.': 'k-dot', '+': 'k-add', '-': 'k-sub', '*': 'k-mul', '/': 'k-div',
  C: 'k-ac', '<': 'k-back', n: 'k-neg', '%': 'k-pct', D: 'k-digits'
}
const DIGIT_PAGE = ['k-7', 'k-8', 'k-9', 'k-4', 'k-5', 'k-6', 'k-1', 'k-2', 'k-3', 'k-ops', 'k-0', 'k-eq']
const OPS_PAGE = ['k-add', 'k-sub', 'k-mul', 'k-div', 'k-dot', 'k-back', 'k-neg', 'k-pct', 'k-digits', 'k-ac']

// A "band": one page. reload() simulates the app being killed and relaunched
// (localStorage, standing in for @system.storage, persists).
async function band(t) {
  const context = await browser.newContext({ viewport: { width: 212, height: 520 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  page.on('pageerror', (e) => assert.fail('page error: ' + e.message))
  const b = {
    page,
    async open() {
      await page.goto(base + '/test/harness/index.html')
      await page.waitForFunction(() => window.__ready === true && window.__storageGets > 0)
      await b.settle()
      await b.noErrors()
    },
    settle: () => page.evaluate(() => new Promise((r) => setTimeout(r, 0))),
    // Kill without warning: no onHide/onDestroy, just a fresh page.
    async kill() {
      await b.open()
    },
    taps: 0,
    async tap(id) {
      await page.click('#' + id)
      await b.settle()
      b.taps++
    },
    async keys(seq) {
      for (const k of seq) {
        const id = KEY_ID[k]
        if (!id) throw new Error('no key for ' + k)
        if (!(await b.has(id))) await b.tap((await b.has('k-ops')) ? 'k-ops' : 'k-digits')
        await b.tap(id)
      }
    },
    has: (id) => page.evaluate((i) => !!document.getElementById(i), id),
    onOps: () => b.has('k-add'),
    // The drawn key inside a key's touch cell.
    keyClass: (id) => page.evaluate((i) => document.querySelector('#' + i + ' > .key').className, id),
    text: (id) => page.evaluate((i) => window.harness.text(i), id),
    main: () => b.text('main'),
    expr: () => b.text('expr'),
    mainSize: () => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('main')).fontSize)),
    saved: () => page.evaluate((k) => localStorage.getItem(k), STORE),
    async noErrors() {
      const errs = await page.evaluate(() => window.__errors)
      assert.deepEqual(errs, [], 'runtime errors')
    },
    issues: () => page.evaluate(() => window.harness.layoutIssues()),
    async layoutOk(label) {
      assert.deepEqual(await b.issues(), [], 'layout issues in ' + label)
    },
    async shot(name) {
      await b.layoutOk(name)
      await page.screenshot({ path: path.join(SHOTS, name + '.png') })
    }
  }
  t.after(() => context.close())
  return b
}

test('opens at 0 with an empty expression line', async (t) => {
  const b = await band(t)
  await b.open()
  assert.equal(await b.main(), '0')
  assert.equal(await b.expr(), '')
  assert.equal(await b.mainSize(), 40)
  assert.equal(await b.onOps(), false, 'opens on the digits')
  await b.shot('01-start')
})

// Drawn keys and their touch cells, in px (1 px = about 0.078 mm).
const geometry = (b, ids) => b.page.evaluate((ids) => ids.map((id) => {
  const c = document.getElementById(id).getBoundingClientRect()
  const k = document.querySelector('#' + id + ' > .key').getBoundingClientRect()
  return { id, cell: [c.left, c.top, c.width, c.height], key: [k.width, k.height] }
}), ids)

test('finger-sized keys whose touch cells tile the keypad with no gaps', async (t) => {
  const b = await band(t)
  await b.open()
  for (const [ids, minKey, cols] of [[DIGIT_PAGE, [61, 79], 3], [OPS_PAGE, [94, 62], 2]]) {
    if (ids === OPS_PAGE) await b.tap('k-ops')
    const g = await geometry(b, ids)
    assert.equal(g.length, ids.length)
    for (const { id, key } of g) assert.ok(key[0] >= minKey[0] && key[1] >= minKey[1], `${id} key is ${key}`)
    // Cells side by side and row on row: every point of the keypad is a key.
    for (let i = 0; i < g.length; i++) {
      const [x, y, w, h] = g[i].cell
      if (i % cols) assert.equal(x, g[i - 1].cell[0] + g[i - 1].cell[2], g[i].id + ' touches its left neighbour')
      if (i >= cols) assert.equal(y, g[i - cols].cell[1] + g[i - cols].cell[3], g[i].id + ' touches the cell above')
    }
    await b.layoutOk(ids === OPS_PAGE ? 'operator page' : 'digit page')
  }
})

test('tapping the gap between two keys still presses a key', async (t) => {
  const b = await band(t)
  await b.open()
  const g = (await geometry(b, ['k-5']))[0]
  // 1 px inside the 5's cell, outside its drawn key.
  await b.page.mouse.click(g.cell[0] + 1, g.cell[1] + 1)
  await b.settle()
  assert.equal(await b.main(), '5')
})

test('the page switch is bottom left on both pages, so one spot flips back and forth', async (t) => {
  const b = await band(t)
  await b.open()
  const [ops] = await geometry(b, ['k-ops'])
  // Near the bottom-left corner: inside +−×÷ here and 123 on the other page.
  const x = ops.cell[0] + 10
  const y = ops.cell[1] + ops.cell[3] - 10
  for (const onOps of [true, false, true, false]) {
    await b.page.mouse.click(x, y)
    await b.settle()
    assert.equal(await b.onOps(), onOps)
  }
  await b.tap('k-ops')
  const [digits, ac] = await geometry(b, ['k-digits', 'k-ac'])
  assert.ok(digits.cell[0] < ac.cell[0], 'AC is right of 123')
  assert.equal(digits.cell[1], ac.cell[1], 'on the same row')
  assert.equal(digits.cell[1] + digits.cell[3], ops.cell[1] + ops.cell[3], 'the bottom row')
  assert.equal(await b.main(), '0', 'the flips did nothing else')
})

test('two pages: operators flip back, backspace stays, 123 returns', async (t) => {
  const b = await band(t)
  await b.open()
  assert.equal(await b.has('k-add'), false)
  await b.tap('k-ops')
  assert.equal(await b.onOps(), true)
  assert.equal(await b.has('k-7'), false)
  await b.shot('13-operator-page')
  await b.tap('k-digits')
  assert.equal(await b.onOps(), false, '123 flips back')
  assert.equal(await b.main(), '0', 'without doing anything')
  await b.keys('12')
  await b.tap('k-ops')
  await b.tap('k-add')
  assert.equal(await b.onOps(), false, 'an operator flips back')
  assert.equal(await b.expr(), '12+')
  await b.keys('345')
  await b.tap('k-ops')
  await b.tap('k-back')
  await b.tap('k-back')
  assert.equal(await b.onOps(), true, 'backspace stays')
  assert.equal(await b.main(), '3')
  for (const id of ['k-dot', 'k-neg', 'k-pct', 'k-ac']) {
    if (!(await b.onOps())) await b.tap('k-ops')
    await b.tap(id)
    assert.equal(await b.onOps(), false, id + ' flips back')
  }
  assert.equal(await b.main(), '0')
  await b.tap('k-ops')
  await b.tap('k-ac')
  assert.equal(await b.onOps(), true, 'AC with nothing to clear stays')
  await b.noErrors()
})

test('128+3×45= takes 11 taps (one extra per operator)', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('128+3*45=')
  assert.equal(await b.main(), '263')
  assert.equal(b.taps, 11)
})

test('a relaunch opens on the digits, with the calculation kept', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('7+')
  await b.tap('k-ops')
  await b.kill()
  assert.equal(await b.onOps(), false)
  assert.equal(await b.expr(), '7+')
})

test('operator precedence, from the keys', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('2+3*')
  assert.equal(await b.expr(), '2+3×')
  assert.equal(await b.main(), '3')
  await b.shot('02-typing')
  await b.keys('4=')
  assert.equal(await b.main(), '14')
  assert.equal(await b.expr(), '2+3×4=')
  await b.shot('03-result')
  await b.noErrors()
})

test('every key works', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('1234567890')
  assert.equal(await b.main(), '1,234,567,890')
  await b.keys('C')
  await b.keys('9-4=')
  assert.equal(await b.main(), '5')
  await b.keys('/2=')
  assert.equal(await b.main(), '2.5')
  await b.keys('n')
  assert.equal(await b.main(), '-2.5')
  await b.keys('%')
  assert.equal(await b.main(), '-0.025')
  await b.keys('<')
  assert.equal(await b.main(), '0')
  await b.keys('.5+.25=')
  assert.equal(await b.main(), '0.75')
  await b.noErrors()
})

test('pressed keys light up until released', async (t) => {
  const b = await band(t)
  await b.open()
  const cls = b.keyClass
  for (const [id, down] of [['k-7', 'key-num-down'], ['k-eq', 'key-eq-down'], ['k-ops', 'key-fn-down'], ['k-ac', 'key-fn-down'], ['k-ops', 'key-fn-down'], ['k-sub', 'key-num-down']]) {
    const box = await b.page.locator('#' + id).boundingBox()
    await b.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await b.page.mouse.down()
    await b.settle()
    assert.ok((await cls(id)).split(' ').includes(down), id + ' shows pressed: ' + (await cls(id)))
    if (id === 'k-7') await b.shot('04-pressed-7')
    if (id === 'k-eq') await b.shot('05-pressed-eq')
    if (id === 'k-ac') await b.shot('14-pressed-ac')
    await b.page.mouse.up()
    await b.settle()
    // A flip key's page is gone once it's released.
    if (await b.has(id)) assert.ok(!(await cls(id)).includes('down'), id + ' released')
  }
  // The taps still registered: 7, =, (flip) AC, (flip) then a pending minus.
  assert.equal(await b.main(), '0')
  assert.equal(await b.expr(), '0-')
  await b.noErrors()
})

test('a sliding touch that is cancelled does not stay lit', async (t) => {
  const b = await band(t)
  await b.open()
  await b.page.dispatchEvent('#k-8', 'pointerdown')
  await b.settle()
  assert.ok((await b.keyClass('k-8')).includes('key-num-down'))
  await b.page.dispatchEvent('#k-8', 'pointercancel')
  await b.settle()
  assert.ok(!(await b.keyClass('k-8')).includes('down'))
  assert.equal(await b.main(), '0', 'no click, no digit')
})

test('no floating-point noise', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('.1+.2=')
  assert.equal(await b.main(), '0.3')
  await b.keys('C1/3=')
  assert.equal(await b.main(), '0.333333333333')
  await b.layoutOk('1/3')
})

test('keep calculating after =', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('2+3=')
  await b.keys('*4')
  assert.equal(await b.expr(), '5×')
  await b.keys('=')
  assert.equal(await b.main(), '20')
  assert.equal(await b.expr(), '5×4=')
  // a digit starts over
  await b.keys('9')
  assert.equal(await b.main(), '9')
  assert.equal(await b.expr(), '')
})

test('dividing by zero shows an error, and a digit recovers', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('8/0=')
  assert.equal(await b.main(), 'Error')
  assert.equal(await b.expr(), '8÷0=')
  assert.ok((await b.page.getAttribute('#main', 'class')).includes('main-error'))
  await b.shot('06-error')
  await b.keys('+')
  assert.equal(await b.main(), 'Error')
  await b.keys('7')
  assert.equal(await b.main(), '7')
  assert.ok(!(await b.page.getAttribute('#main', 'class')).includes('main-error'))
})

test('long numbers shrink the font step by step and stay inside the screen', async (t) => {
  const b = await band(t)
  await b.open()
  const sizes = []
  for (const d of '123456789012') {
    await b.keys(d)
    sizes.push(await b.mainSize())
    await b.layoutOk('typing ' + (await b.main()))
  }
  for (let i = 1; i < sizes.length; i++) assert.ok(sizes[i] <= sizes[i - 1], 'never grows: ' + sizes)
  assert.equal(sizes[0], 40)
  assert.equal(sizes.at(-1), 20)
  assert.equal(new Set(sizes).size, 5, 'uses all five sizes: ' + sizes)
  await b.keys('3') // 13th digit ignored
  assert.equal(await b.main(), '123,456,789,012')
  await b.shot('07-twelve-digits')
  // The widest thing the main line can hold: sign, 12 digits, point.
  await b.keys('n.')
  assert.equal(await b.main(), '-123,456,789,012')
  await b.keys('C')
  await b.keys('n99999999999.9')
  assert.equal(await b.main(), '-99,999,999,999.9')
  assert.ok(!(await b.main()).startsWith('…'))
  await b.shot('08-widest')
})

test('a long expression cuts off its start, not its end', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('123456*789012+345678/9876-54321*')
  const e = await b.expr()
  assert.ok(e.startsWith('…'), e)
  assert.ok(e.endsWith('54,321×'), e)
  await b.layoutOk('long expression')
  await b.keys('2=')
  assert.ok((await b.expr()).endsWith('×2='))
  assert.equal(await b.main(), '97,408,156,865') // 123456×789012 + 345678÷9876 − 54321×2
  await b.shot('09-long-expression')
})

test('huge and tiny results use an exponent and fit', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('999999999999*999999999999=')
  assert.equal(await b.main(), '1e24')
  await b.keys('C123456789*n987654321=')
  assert.equal(await b.main(), '-1.219326e17')
  await b.shot('10-exponent')
  await b.keys('C1/1000000/10000000=')
  assert.equal(await b.main(), '1e-13')
  await b.layoutOk('tiny')
})

test('state survives the app being killed at any point', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('12+3*')
  await b.kill()
  assert.equal(await b.expr(), '12+3×')
  assert.equal(await b.main(), '3')
  await b.keys('4')
  await b.kill()
  assert.equal(await b.main(), '4')
  await b.keys('=')
  await b.kill()
  assert.equal(await b.main(), '24')
  assert.equal(await b.expr(), '12+3×4=')
  await b.keys('*2=')
  assert.equal(await b.main(), '48', 'keeps calculating from a restored result')
  await b.keys('/0=')
  await b.kill()
  assert.equal(await b.main(), 'Error')
  await b.keys('C')
  await b.kill()
  assert.equal(await b.main(), '0')
  assert.equal(await b.expr(), '')
  await b.noErrors()
})

test('saves on every change, without waiting for onHide', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('7')
  assert.match(await b.saved(), /"e":"7"/)
  await b.keys('+')
  assert.match(await b.saved(), /"t":\["7","\+"\]/)
})

test('corrupt saved state does not crash the app', async (t) => {
  const b = await band(t)
  await b.open()
  await b.page.evaluate((k) => localStorage.setItem(k, '{not json'), STORE)
  await b.kill()
  assert.equal(await b.main(), '0')
  await b.page.evaluate((k) => localStorage.setItem(k, '{"v":1,"t":["1","^"],"e":"2"}'), STORE)
  await b.kill()
  assert.equal(await b.main(), '0')
  await b.keys('5')
  assert.equal(await b.main(), '5')
})

test('the layout check catches broken layouts', async (t) => {
  const b = await band(t)
  await b.open()
  const broken = async (css) => {
    const handle = await b.page.addStyleTag({ content: css })
    const issues = await b.issues()
    await handle.evaluate((el) => el.remove())
    return issues.join('\n')
  }
  // Keypad pushed down into the bottom corners.
  assert.match(await broken('#screen .pad { margin-top: 40px }'), /outside the capsule: key key-digits/)
  // 12 px lower still fits thanks to the keys' rounded corners; square
  // corners there would poke into the capsule's.
  assert.equal(await broken('#screen .pad { margin-top: 16px }'), '')
  assert.match(await broken('#screen .pad { margin-top: 16px } #screen .key { border-radius: 0 }'), /outside the capsule: key key-digits/)
  // Display moved up into the top corners: caught on the text glyphs.
  await b.keys('1234567+')
  assert.match(await broken('#screen .display { margin-top: 2px }'), /outside the capsule: expr|outside the capsule: main/)
  await b.keys('C')
  // Too wide for the screen.
  assert.match(await broken('#screen .row-digits { width: 230px }'), /off-screen: row/)
  // Side margin in the middle of the screen.
  assert.match(await broken('#screen .pad-digits { margin-left: 14px }'), /outside the capsule: key key-digits/)
  // Same on the operator page.
  await b.tap('k-ops')
  assert.match(await broken('#screen .pad { margin-top: 40px }'), /outside the capsule: key key-ops/)
  await b.tap('k-digits')
  // Text bigger than its row.
  await b.keys('12345678')
  assert.match(await broken('#screen .main { font-size: 80px !important }'), /spills out of parent: main/)
  assert.match(await broken('#screen .label { font-size: 60px; width: 20px }'), /text overflows its box/)
  // And with the injected styles gone, the page is clean again.
  await b.layoutOk('after removing the breakage')
  // The capsule rule itself, at known points.
  const ok = (x, y) => b.page.evaluate(([x, y]) => window.harness.capsuleOk(x, y), [x, y])
  assert.equal(await ok(106, 3), true)
  assert.equal(await ok(106, 2), false)
  assert.equal(await ok(30, 30), false)
  assert.equal(await ok(8, 300), true)
  assert.equal(await ok(7, 300), false)
  assert.equal(await ok(106, 517), true)
  assert.equal(await ok(20, 500), false)
})

test('secret: AC five times in a row shows the credit; any key dismisses it', async (t) => {
  const b = await band(t)
  await b.open()
  const shown = () => b.page.evaluate(() => !!document.getElementById('secret-1'))
  const ac = async (n) => {
    for (let i = 0; i < n; i++) await b.tap('k-ac')
  }
  await b.keys('12+3')
  await b.tap('k-ops')
  await ac(1)
  assert.equal(await b.main(), '0')
  assert.equal(await b.onOps(), false, 'an AC that clears something flips back')
  await b.tap('k-ops')
  await ac(4)
  assert.equal(await b.onOps(), true, 'with nothing to clear, AC stays put')
  assert.equal(await shown(), false, 'four is not enough, and the flip restarted the count')
  await b.tap('k-back')
  await ac(4)
  assert.equal(await shown(), false, 'must be in a row')
  await b.tap('k-digits')
  await b.tap('k-ops')
  await ac(4)
  assert.equal(await shown(), false, 'a page flip breaks the row too')
  await ac(1)
  assert.equal(await shown(), true)
  assert.equal(await b.text('secret-1'), 'Made with love')
  assert.equal(await b.text('secret-2'), 'by Ari Wilson.')
  assert.equal(await b.main(), null, 'replaces the number lines')
  await b.shot('11-secret')
  // The next key dismisses it and still does its job.
  await b.keys('7')
  assert.equal(await shown(), false)
  assert.equal(await b.main(), '7')
  // A sixth AC dismisses it too, and the count starts over.
  await b.tap('k-ops')
  await ac(1) // clears the 7 and flips back
  await b.tap('k-ops')
  await ac(5)
  assert.equal(await shown(), true)
  await ac(1)
  assert.equal(await shown(), false)
  await ac(4)
  assert.equal(await shown(), true, '5 counted from the dismissing AC')
  // Not remembered across a relaunch.
  await b.kill()
  assert.equal(await shown(), false)
  assert.equal(await b.main(), '0')
  // From a fresh start it's +−×÷, then AC five times.
  await b.tap('k-ops')
  await ac(5)
  assert.equal(await shown(), true)
  await b.noErrors()
})

test('= over and over repeats the last operation, also after a relaunch', async (t) => {
  const b = await band(t)
  await b.open()
  await b.keys('2+3=')
  assert.equal(await b.main(), '5')
  await b.keys('=')
  assert.equal(await b.main(), '8')
  assert.equal(await b.expr(), '5+3=')
  await b.keys('==')
  assert.equal(await b.main(), '14')
  assert.equal(await b.expr(), '11+3=')
  await b.shot('12-repeat-equals')
  await b.kill()
  await b.keys('=')
  assert.equal(await b.main(), '17')
  await b.keys('C3*2===')
  assert.equal(await b.main(), '24')
  await b.noErrors()
})
