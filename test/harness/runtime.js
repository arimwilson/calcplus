// A minimal stand-in for the Vela JS runtime, for testing in Chromium.
//
// It loads the *compiled* bundle from build/ (the same JS that goes into the
// .rpk), implements the three template builtins the compiler emits
// (aiot.__ce__ element, __ci__ if, __cf__ for), turns the compiled style table
// into CSS, and stubs the system modules the app imports. Re-renders patch the
// DOM in place, as the band's runtime keeps its nodes, so a key that re-renders
// on touchstart still receives the click. Layout is Chromium's flexbox, not
// the band's renderer, so pixel-exact results can differ on the device;
// logic, bindings and events are the real code.

const SCREEN_W = 212
const SCREEN_H = 520
// The panel is a capsule: corner radius 106 (half the width). Everything drawn
// must stay inside a 103 px radius in the top and bottom 106 px, and 8 px from
// the sides elsewhere.
const CAP_R = 106
const SAFE_R = 103
const SIDE_MARGIN = 8

window.__errors = []
window.__storageGets = 0

const systemModules = {
  'system.storage': {
    get(o) {
      // Async like the device.
      setTimeout(() => {
        const v = localStorage.getItem('st:' + o.key)
        o.success && o.success(v === null ? o.default : v)
        window.__storageGets++
      }, 0)
    },
    set(o) {
      localStorage.setItem('st:' + o.key, o.value)
      o.success && setTimeout(o.success, 0)
    }
  }
}

window.$app_require$ = function (name) {
  const m = name.replace('@app-module/', '')
  if (!systemModules[m]) throw new Error('harness: no stub for ' + name)
  return systemModules[m]
}

window.aiot = {
  __ce__: (type, o, children) => ({ k: 'el', type, opts: (o && o.__opts__) || {}, children: children || [] }),
  __ci__: (o, fn) => ({ k: 'if', opts: o.__opts__, fn }),
  __cf__: (o, fn) => ({ k: 'for', opts: o.__opts__, fn })
}

async function loadBundle(url, exportsObj) {
  const src = await (await fetch(url, { cache: 'no-store' })).text()
  const mod = await import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
  mod.default(globalThis, globalThis, window, exportsObj, null)
}

function kebab(s) {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

function styleTableToCss(table) {
  return table
    .map(([parts, decls]) => {
      // parts: a descendant chain of [kind, name]; kind 0 is a class.
      const sel = parts
        .map(([kind, name]) => {
          if (kind !== 0) throw new Error('harness: unsupported selector kind ' + kind)
          return '.' + name
        })
        .join(' ')
      const body = Object.entries(decls)
        .map(([k, v]) => kebab(k) + ':' + v)
        .join(';')
      return '#screen ' + sel + '{' + body + '}'
    })
    .join('\n')
}

const val = (x) => (typeof x === 'function' ? x() : x)

// Vela touch events, driven by the mouse in Chromium. Order matches a tap on
// the band: touchstart, touchend, click.
const EVENT_MAP = { touchstart: 'pointerdown', touchend: 'pointerup', touchcancel: 'pointercancel', click: 'click' }
const TAGS = { div: 'div', text: 'span', image: 'img' }

// Expand if/for into a flat list of element vnodes.
function expand(node, out) {
  if (Array.isArray(node)) {
    node.forEach((n) => expand(n, out))
  } else if (node.k === 'if') {
    if (val(node.opts.shown)) expand(node.fn(), out)
  } else if (node.k === 'for') {
    ;(val(node.opts.exp) || []).forEach((item, i) => expand(node.fn(i, item), out))
  } else {
    out.push(node)
  }
  return out
}

function create(v) {
  if (!TAGS[v.type]) throw new Error('harness: unsupported element ' + v.type)
  const el = document.createElement(TAGS[v.type])
  el.dataset.type = v.type
  el.__handlers = {}
  for (const ev of Object.keys(v.opts.events || {})) {
    const domEv = EVENT_MAP[ev]
    if (!domEv) throw new Error('harness: unsupported event ' + ev)
    el.addEventListener(domEv, (e) => {
      const fn = el.__handlers[ev]
      if (!fn) return
      try {
        fn(e)
      } catch (err) {
        window.__errors.push(String(err && err.stack ? err.stack : err))
      }
    })
  }
  update(el, v)
  return el
}

function update(el, v) {
  const o = v.opts
  const id = o.id ? val(o.id) : ''
  if (el.id !== id) el.id = id
  const cls = val(o.classList)
  const className = cls ? (Array.isArray(cls) ? cls : String(cls).split(' ')).filter(Boolean).join(' ') : ''
  if (el.className !== className) el.className = className
  el.removeAttribute('style')
  const st = val(o.style)
  if (st) for (const [k, s] of Object.entries(st)) el.style[k] = s
  if (v.type === 'image') {
    // Absolute app paths resolve against the package root, which is build/.
    const src = '/build' + val(o.src)
    if (el.getAttribute('src') !== src) el.setAttribute('src', src)
  }
  if (o.value !== undefined) {
    const text = String(val(o.value))
    if (el.textContent !== text) el.textContent = text
  }
  el.__handlers = Object.assign({}, o.events || {})
  patchChildren(el, expand(v.children, []))
}

function patchChildren(parent, vnodes) {
  const olds = Array.from(parent.children)
  vnodes.forEach((v, i) => {
    const old = olds[i]
    if (old && old.dataset.type === v.type) update(old, v)
    else if (old) parent.replaceChild(create(v), old)
    else parent.appendChild(create(v))
  })
  for (let i = vnodes.length; i < olds.length; i++) olds[i].remove()
}

// ---------- layout checks ----------

function capsuleOk(x, y) {
  const e = 0.01
  if (x < SIDE_MARGIN - e || x > SCREEN_W - SIDE_MARGIN + e) return false
  if (y < CAP_R) return Math.hypot(x - SCREEN_W / 2, y - CAP_R) <= SAFE_R + e
  if (y > SCREEN_H - CAP_R) return Math.hypot(x - SCREEN_W / 2, y - (SCREEN_H - CAP_R)) <= SAFE_R + e
  return true
}

// Points on the outline of an element's rounded rectangle.
function outline(r, cs) {
  const pts = []
  const lim = Math.min(r.width, r.height) / 2
  const rad = (p) => Math.min(parseFloat(cs[p]) || 0, lim)
  const tl = rad('borderTopLeftRadius')
  const tr = rad('borderTopRightRadius')
  const br = rad('borderBottomRightRadius')
  const bl = rad('borderBottomLeftRadius')
  const corners = [
    [tl, r.left, r.top, -1, -1],
    [tr, r.right, r.top, 1, -1],
    [br, r.right, r.bottom, 1, 1],
    [bl, r.left, r.bottom, -1, 1]
  ]
  for (const [R, x, y, sx, sy] of corners) {
    const cx = x - sx * R
    const cy = y - sy * R
    for (let i = 0; i <= 16; i++) {
      const a = (i / 16) * (Math.PI / 2)
      pts.push([cx + sx * R * Math.cos(a), cy + sy * R * Math.sin(a)])
    }
  }
  // Straight edges, between the corner arcs.
  const edge = (x0, y0, x1, y1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2))
    for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n])
  }
  edge(r.left + tl, r.top, r.right - tr, r.top)
  edge(r.left + bl, r.bottom, r.right - br, r.bottom)
  edge(r.left, r.top + tl, r.left, r.bottom - bl)
  edge(r.right, r.top + tr, r.right, r.bottom - br)
  return pts
}

function label(el) {
  const name = el.id || el.className || el.tagName
  return name + (el.dataset.type === 'text' ? ' "' + el.textContent + '"' : '')
}

// Report anything that would be off-screen, spill out of its parent, overflow
// its own box, or reach into the capsule's rounded corners.
function layoutIssues() {
  const screen = document.getElementById('screen')
  const issues = []
  const s = screen.getBoundingClientRect()
  for (const el of screen.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const tag = label(el)
    if (r.left < s.left - 0.5 || r.top < s.top - 0.5 || r.right > s.right + 0.5 || r.bottom > s.bottom + 0.5) {
      issues.push('off-screen: ' + tag + ' ' + JSON.stringify([r.left - s.left, r.top - s.top, r.right - s.left, r.bottom - s.top]))
    }
    const p = el.parentElement
    if (p && p !== screen) {
      const pr = p.getBoundingClientRect()
      if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5 || r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5) {
        issues.push('spills out of parent: ' + tag)
      }
    }
    if (el.dataset.type === 'text' && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      issues.push('text overflows its box: ' + tag)
    }
    // Capsule corners: the outline of anything with a background, the box of
    // images, and the line boxes of text glyphs (a Range rect, which is the
    // font's full ascent/descent, so a little conservative).
    const local = (pts) => pts.map(([x, y]) => [x - s.left, y - s.top])
    let pts = []
    const cs = getComputedStyle(el)
    const bg = cs.backgroundColor
    // Black on the black panel draws nothing.
    const drawn = bg && bg !== 'transparent' && bg !== 'rgb(0, 0, 0)' && !/rgba\(.*,\s*0\)$/.test(bg)
    if (drawn) pts = pts.concat(local(outline(r, cs)))
    if (el.dataset.type === 'image') pts = pts.concat(local(outline(r, { })))
    if (el.dataset.type === 'text' && el.firstChild) {
      const range = document.createRange()
      range.selectNodeContents(el)
      for (const g of range.getClientRects()) {
        pts = pts.concat(local([[g.left, g.top], [g.right, g.top], [g.left, g.bottom], [g.right, g.bottom]]))
      }
    }
    const bad = pts.find(([x, y]) => !capsuleOk(x, y))
    if (bad) issues.push('outside the capsule: ' + tag + ' at ' + JSON.stringify(bad.map((n) => Math.round(n * 10) / 10)))
  }
  return issues
}

async function boot() {
  const appExp = {}
  await loadBundle('/build/app.js', appExp)
  const pageExp = {}
  await loadBundle('/build/pages/index/index.js', pageExp)
  pageExp.entry(pageExp)
  const def = pageExp.default

  const css = document.createElement('style')
  css.textContent = styleTableToCss(def.style)
  document.head.appendChild(css)

  const screen = document.getElementById('screen')
  const data = JSON.parse(JSON.stringify(def.data))
  const vm = {}
  let pending = false
  let renders = 0
  function render() {
    pending = false
    renders++
    patchChildren(screen, expand(def.template(vm), []))
  }
  function schedule() {
    if (pending) return
    pending = true
    queueMicrotask(render)
  }
  for (const k of Object.keys(data)) {
    Object.defineProperty(vm, k, {
      get: () => data[k],
      set: (v) => {
        if (data[k] === v) return
        data[k] = v
        schedule()
      },
      enumerable: true
    })
  }
  for (const k of Object.keys(def)) {
    if (typeof def[k] === 'function' && k !== 'template') vm[k] = def[k].bind(vm)
  }
  function lifecycle(name) {
    try {
      if (vm[name]) vm[name]()
    } catch (err) {
      window.__errors.push(name + ': ' + String(err && err.stack ? err.stack : err))
    }
  }

  window.harness = {
    vm,
    def,
    lifecycle,
    layoutIssues,
    capsuleOk,
    renders: () => renders,
    text: (id) => {
      const el = document.getElementById(id)
      return el ? el.textContent : null
    },
    size: { w: SCREEN_W, h: SCREEN_H }
  }

  lifecycle('onInit')
  render()
  lifecycle('onShow')
  window.__ready = true
}

boot().catch((err) => {
  window.__errors.push('boot: ' + String(err && err.stack ? err.stack : err))
  window.__ready = true
})
