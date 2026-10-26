// Pure calculator state. No system modules here, so it runs under plain Node
// for the unit tests. Every function returns a new state object.
//
// State:
//   tokens  committed part of the expression: number, op, number, op, ...
//           always empty or ending in an op. Ops are '+', '-', '*', '/'.
//   entry   the number being typed (a string), or null right after an op.
//   locked  entry is a computed value (after =, ± on a result, %): typing a
//           digit replaces it instead of appending to it.
//   history tokens of the last evaluated expression, shown as "...=" in the
//           expression line; null otherwise.
//   error   true after dividing by zero or overflowing.

export var MAX_DIGITS = 12 // digits in one number
export var MAX_OPS = 20 // operators in one expression
export var SIG_DIGITS = 12 // results are rounded to this many significant digits
var MAX_ABS = 1e100
var EXP_SIG = 7 // significant digits shown when a result needs an exponent

export function newCalc() {
  return { tokens: [], entry: '0', locked: false, history: null, error: false }
}

function copy(s) {
  return {
    tokens: s.tokens.slice(),
    entry: s.entry,
    locked: s.locked,
    history: s.history ? s.history.slice() : null,
    error: s.error
  }
}

function isOp(t) {
  return t === '+' || t === '-' || t === '*' || t === '/'
}

// Significant digits typed so far: the 0 in "0.5" doesn't count.
function digitCount(str) {
  var n = 0
  var i = str.charAt(0) === '-' ? 1 : 0
  if (str.slice(i, i + 2) === '0.') i += 2
  for (; i < str.length; i++) {
    var c = str.charCodeAt(i)
    if (c >= 48 && c <= 57) n++
  }
  return n
}

// What a typed number commits as: no trailing '.', no '-0'.
function normalize(str) {
  if (str.charAt(str.length - 1) === '.') str = str.slice(0, -1)
  if (str === '-0' || str === '' || str === '-') str = '0'
  return str
}

// The number the main line shows when nothing is being typed.
function lastNumber(s) {
  return s.tokens.length >= 2 ? s.tokens[s.tokens.length - 2] : '0'
}

// ---------- keys ----------

export function pressDigit(s, d) {
  if (s.error || s.history) s = newCalc()
  else s = copy(s)
  if (s.entry === null || s.locked) {
    s.entry = d
    s.locked = false
    return s
  }
  if (s.entry === '0') {
    s.entry = d
    return s
  }
  if (s.entry === '-0') {
    s.entry = '-' + d
    return s
  }
  if (digitCount(s.entry) >= MAX_DIGITS) return s
  s.entry += d
  return s
}

export function pressDot(s) {
  if (s.error || s.history) s = newCalc()
  else s = copy(s)
  if (s.entry === null || s.locked) {
    s.entry = '0.'
    s.locked = false
    return s
  }
  if (s.entry.indexOf('.') >= 0 || s.entry.indexOf('e') >= 0) return s
  if (digitCount(s.entry) >= MAX_DIGITS) return s
  s.entry += '.'
  return s
}

export function pressOp(s, op) {
  if (s.error || !isOp(op)) return s
  s = copy(s)
  if (s.history) {
    // Keep calculating from the result.
    s.history = null
    s.tokens = []
  }
  if (s.entry === null) {
    // Two ops in a row: the second replaces the first.
    if (s.tokens.length) s.tokens[s.tokens.length - 1] = op
    return s
  }
  if (s.tokens.length / 2 >= MAX_OPS) return s
  s.tokens.push(normalize(s.entry), op)
  s.entry = null
  s.locked = false
  return s
}

export function pressEquals(s) {
  if (s.error) return s
  if (s.history) {
    // = again repeats the last operation on the result: 2+3= 5, = 8, = 11.
    // The last operation is the last op and the number after it, so
    // 2+3×4= 14 repeats as ×4. Nothing to repeat after "7=" or "5+=".
    var h = s.history
    if (h.length < 3) return s
    return evalTokens([s.entry, h[h.length - 2], h[h.length - 1]])
  }
  var toks = s.tokens.slice()
  if (s.entry === null) toks.pop() // "2+=" evaluates "2"
  else toks.push(normalize(s.entry))
  if (toks.length < 3 && s.entry !== null) {
    // Just a number: tidy it ("5." -> "5").
    var t = copy(s)
    t.entry = normalize(s.entry)
    return t
  }
  return evalTokens(toks)
}

// The state after evaluating toks: the result (or an error), with toks kept
// as the history shown in the expression line.
function evalTokens(toks) {
  var r = evaluate(toks)
  var out = newCalc()
  out.history = toks
  if (r === null) {
    out.error = true
    out.entry = null
    return out
  }
  out.entry = r
  out.locked = true
  return out
}

export function pressClear() {
  return newCalc()
}

export function pressBack(s) {
  if (s.error || s.history) return newCalc()
  s = copy(s)
  if (s.entry === null || (s.entry === '0' && !s.locked && s.tokens.length)) {
    // Undo the op: the number before it becomes editable again.
    if (!s.tokens.length) return s
    s.tokens.pop()
    s.entry = s.tokens.pop()
    s.locked = s.entry.indexOf('e') >= 0
    return s
  }
  // A computed value is removed whole, not digit by digit.
  var e = s.locked || s.entry.indexOf('e') >= 0 ? '' : s.entry.slice(0, -1)
  s.locked = false
  s.entry = e === '' || e === '-' ? '0' : e
  return s
}

export function pressNegate(s) {
  if (s.error) return s
  s = copy(s)
  if (s.entry === null) {
    // After an op: start a negative number.
    s.entry = '-0'
    return s
  }
  if (s.history) s.history = null // the result, negated, stays as a value
  var e = s.entry
  if (e.charAt(0) === '-') s.entry = e.slice(1)
  else if (!(s.locked && Number(e) === 0)) s.entry = '-' + e
  return s
}

export function pressPercent(s) {
  if (s.error || s.entry === null) return s
  s = copy(s)
  s.history = null
  var r = roundValue(Number(normalize(s.entry)) / 100)
  if (r === null) return s
  s.entry = r
  s.locked = true
  return s
}

// ---------- secret ----------

// AC this many times in a row shows the credit line.
export var SECRET_AC_PRESSES = 5

// AC presses in a row, counting this key; any other key resets it.
export function nextAcStreak(streak, key) {
  return key === 'ac' ? streak + 1 : 0
}

// key: '0'..'9', '.', '+', '-', '*', '/', '=', 'ac', 'back', 'neg', 'pct'
export function press(s, key) {
  if (key.length === 1 && key >= '0' && key <= '9') return pressDigit(s, key)
  if (key === '.') return pressDot(s)
  if (isOp(key)) return pressOp(s, key)
  if (key === '=') return pressEquals(s)
  if (key === 'ac') return pressClear()
  if (key === 'back') return pressBack(s)
  if (key === 'neg') return pressNegate(s)
  if (key === 'pct') return pressPercent(s)
  return s
}

// ---------- arithmetic ----------

// Round to SIG_DIGITS significant digits and return the shortest string, or
// null if the number is not finite or too large.
export function roundValue(x) {
  if (!isFinite(x) || Math.abs(x) >= MAX_ABS) return null
  var r = Number(x.toPrecision(SIG_DIGITS))
  if (r === 0) return '0'
  if (Math.abs(r) < 1) {
    // At most SIG_DIGITS decimals, leading zeros included, so a small
    // result stays short in plain notation; only what would round to 0 keeps
    // an exponent.
    var f = r.toFixed(SIG_DIGITS)
    if (Number(f) === 0) return String(r)
    return f.replace(/0+$/, '').replace(/\.$/, '')
  }
  return String(r)
}

// tokens: number, op, number, ... (strings). × and ÷ bind tighter than + and
// −. Returns the rounded result string, or null on ÷0 or overflow.
export function evaluate(tokens) {
  var terms = [] // after folding * and /
  var signs = []
  var acc = Number(tokens[0])
  for (var i = 1; i < tokens.length; i += 2) {
    var op = tokens[i]
    var n = Number(tokens[i + 1])
    if (op === '*') acc = acc * n
    else if (op === '/') {
      if (n === 0) return null
      acc = acc / n
    } else {
      terms.push(acc)
      signs.push(op)
      acc = n
    }
    if (!isFinite(acc)) return null
  }
  terms.push(acc)
  var sum = terms[0]
  for (var j = 0; j < signs.length; j++) sum = signs[j] === '+' ? sum + terms[j + 1] : sum - terms[j + 1]
  return roundValue(sum)
}

// ---------- display ----------

var OP_SYMBOL = { '+': '+', '-': '-', '*': '×', '/': '÷' }

function group(intPart) {
  var out = ''
  while (intPart.length > 3) {
    out = ',' + intPart.slice(-3) + out
    intPart = intPart.slice(0, -3)
  }
  return intPart + out
}

// A number string as shown: thousands separators for typed and plain
// numbers; a short mantissa and "e" for values that need an exponent.
export function fmtNumber(str) {
  if (str === null || str === undefined) return ''
  var neg = str.charAt(0) === '-'
  var body = neg ? str.slice(1) : str
  var x = Number(str)
  var ax = Math.abs(x)
  // Typed numbers stay below 1e12 (MAX_DIGITS); results that don't, or that
  // roundValue() left with an exponent, are shown with a short mantissa.
  if (body.indexOf('e') >= 0 || ax >= 1e12) {
    var m = x.toExponential(EXP_SIG - 1).split('e')
    var mant = m[0]
    if (mant.indexOf('.') >= 0) mant = mant.replace(/0+$/, '').replace(/\.$/, '')
    var ex = m[1].charAt(0) === '+' ? m[1].slice(1) : m[1]
    return mant + 'e' + ex
  }
  var dot = body.indexOf('.')
  var intPart = dot >= 0 ? body.slice(0, dot) : body
  var frac = dot >= 0 ? body.slice(dot) : ''
  return (neg ? '-' : '') + group(intPart) + frac
}

// Expression line: committed tokens, or the evaluated expression with "=".
export function exprText(s) {
  var toks = s.history || s.tokens
  var out = ''
  for (var i = 0; i < toks.length; i++) out += isOp(toks[i]) ? OP_SYMBOL[toks[i]] : fmtNumber(toks[i])
  if (s.history) out += '='
  return out
}

// Main line: the error, the number being typed or the result, or the last
// committed number while an op is pending.
export function mainText(s) {
  if (s.error) return 'Error'
  return fmtNumber(s.entry === null ? lastNumber(s) : s.entry)
}

// ---------- fitting text ----------

// Rough advance widths in em, on the generous side so the band's font
// (MiSans) has room to spare: Chromium's fallback fonts are wider than it.
function charEm(c) {
  if (c >= '0' && c <= '9') return 0.6
  if (c === ',' || c === '.') return 0.3
  if (c === '-') return 0.4
  if (c === '×' || c === '÷' || c === '+' || c === '=') return 0.62
  if (c === '…') return 0.9
  if (c === 'e') return 0.58
  return 0.65
}

export function textWidth(str, size) {
  var w = 0
  for (var i = 0; i < str.length; i++) w += charEm(str.charAt(i))
  return w * size
}

// Pick the largest size that fits; if none does, use the smallest and cut
// the start of the line, marking it with "…". Returns {text, size}.
export function fitText(str, sizes, width) {
  for (var i = 0; i < sizes.length; i++) {
    if (textWidth(str, sizes[i]) <= width) return { text: str, size: sizes[i] }
  }
  var size = sizes[sizes.length - 1]
  var cut = str
  while (cut.length > 1 && textWidth('…' + cut, size) > width) cut = cut.slice(1)
  return { text: '…' + cut, size: size }
}

// ---------- persistence ----------

export function serialize(s) {
  return JSON.stringify({ v: 1, t: s.tokens, e: s.entry, l: s.locked, h: s.history, x: s.error })
}

var NUM_RE = /^-?(\d+\.?\d*|\d*\.\d+)(e[+-]?\d+)?$/

function validNum(t) {
  return typeof t === 'string' && t.length <= 40 && NUM_RE.test(t)
}

function validTokens(t, needTrailingOp) {
  if (!Array.isArray(t) || t.length > MAX_OPS * 2 + 2) return false
  for (var i = 0; i < t.length; i++) {
    if (i % 2 === 0 ? !validNum(t[i]) : !isOp(t[i])) return false
  }
  return needTrailingOp ? t.length % 2 === 0 : t.length % 2 === 1
}

// Anything unreadable gives a fresh calculator.
export function deserialize(str) {
  try {
    if (!str) return newCalc()
    var o = JSON.parse(str)
    if (!o || o.v !== 1) return newCalc()
    var s = {
      tokens: o.t,
      entry: o.e === null ? null : o.e,
      locked: o.l === true,
      history: o.h === null || o.h === undefined ? null : o.h,
      error: o.x === true
    }
    if (!validTokens(s.tokens, true)) return newCalc()
    if (s.history !== null && !validTokens(s.history, false)) return newCalc()
    if (s.entry !== null && (!validNum(s.entry) && s.entry !== '-0' && !/^-?\d+\.$/.test(s.entry))) return newCalc()
    if (s.entry === null && !s.error && !s.tokens.length) return newCalc()
    return s
  } catch (e) {
    return newCalc()
  }
}
