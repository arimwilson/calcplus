import test from 'node:test'
import assert from 'node:assert/strict'
import * as c from '../src/common/calc.js'

// Keys as a string: digits . + - * / = as themselves, C = AC, < = backspace,
// n = ±, % = percent.
const KEY = { C: 'ac', '<': 'back', n: 'neg', '%': 'pct' }
function run(keys, s = c.newCalc()) {
  for (const k of keys) s = c.press(s, KEY[k] || k)
  return s
}
const main = (keys) => c.mainText(run(keys))
const expr = (keys) => c.exprText(run(keys))

test('starts at 0 with an empty expression', () => {
  const s = c.newCalc()
  assert.equal(c.mainText(s), '0')
  assert.equal(c.exprText(s), '')
})

test('typing digits, leading zeros and the decimal point', () => {
  assert.equal(main('123'), '123')
  assert.equal(main('007'), '7')
  assert.equal(main('0.05'), '0.05')
  assert.equal(main('.5'), '0.5')
  assert.equal(main('1.2.3'), '1.23', 'second point ignored')
  assert.equal(main('1234567'), '1,234,567')
  assert.equal(main('1234.5678'), '1,234.5678')
})

test('a number holds at most 12 digits', () => {
  assert.equal(main('1234567890123'), '123,456,789,012')
  assert.equal(main('0.123456789012'), '0.123456789012', 'the leading 0 does not count')
  assert.equal(main('0.1234567890123'), '0.123456789012')
  assert.equal(main('n0.1234567890123'), '-0.123456789012')
  assert.equal(main('12345678901.23'), '12,345,678,901.2')
  assert.equal(main('123456789012.'), '123,456,789,012', 'no point once full')
})

test('operator precedence', () => {
  assert.equal(main('2+3*4='), '14')
  assert.equal(main('2*3+4='), '10')
  assert.equal(main('10-4/2='), '8')
  assert.equal(main('8/4/2='), '1', 'left to right')
  assert.equal(main('10-3-2='), '5', 'left to right')
  assert.equal(main('2+3*4-6/3='), '12')
  assert.equal(main('1-2*3='), '-5')
})

test('expression line while typing and after =', () => {
  assert.equal(expr('2+3*'), '2+3×')
  assert.equal(main('2+3*'), '3', 'shows the last number while an op is pending')
  assert.equal(main('2+3*4'), '4')
  assert.equal(expr('2+3*4='), '2+3×4=')
  assert.equal(expr('1000/8='), '1,000÷8=')
  assert.equal(expr('5-2='), '5-2=')
})

test('a second operator replaces the first', () => {
  assert.equal(expr('5+*'), '5×')
  assert.equal(main('5+*2='), '10')
})

test('= with a trailing op or nothing to do', () => {
  assert.equal(main('5+='), '5')
  assert.equal(expr('5+='), '5=')
  assert.equal(main('7='), '7')
  assert.equal(expr('7='), '')
  assert.equal(main('7.='), '7')
})

test('keeps calculating from a result', () => {
  assert.equal(main('2+3=*4='), '20')
  assert.equal(expr('2+3=*'), '5×')
  assert.equal(expr('2+3=*4='), '5×4=')
  // A digit after = starts over.
  assert.equal(main('2+3=7'), '7')
  assert.equal(expr('2+3=7'), '')
  assert.equal(main('2+3=.5'), '0.5')
})

test('no floating-point noise', () => {
  assert.equal(main('.1+.2='), '0.3')
  assert.equal(main('.3-.1='), '0.2')
  assert.equal(main('1.1*1.1='), '1.21')
  assert.equal(main('1/3='), '0.333333333333')
  assert.equal(main('2/3='), '0.666666666667')
  assert.equal(main('1/3*3='), '1')
  assert.equal(main('100*1.1='), '110')
  assert.equal(main('.1*3='), '0.3')
  assert.equal(main('4.35*100='), '435')
  assert.equal(main('1-.9='), '0.1')
})

test('dividing by zero is an error; any digit or AC recovers', () => {
  let s = run('8/0=')
  assert.equal(c.mainText(s), 'Error')
  assert.equal(c.exprText(s), '8÷0=')
  assert.equal(c.mainText(run('+', s)), 'Error', 'ops ignored')
  assert.equal(c.mainText(run('n%=', s)), 'Error')
  assert.equal(c.mainText(run('5', s)), '5')
  assert.equal(c.exprText(run('5', s)), '')
  assert.equal(c.mainText(run('C', s)), '0')
  assert.equal(c.mainText(run('<', s)), '0')
  assert.equal(main('5+0/0='), 'Error')
  assert.equal(main('0/5='), '0')
  assert.equal(main('5/-0='), '5', '"-" here is an op: 5 - 0') // sanity of the key notation
  assert.equal(main('5/n0='), 'Error', '÷ by -0')
})

test('big and small results', () => {
  assert.equal(main('999999999999*999999999999='), '1e24')
  assert.equal(main('123456789*1000000='), '1.234568e14')
  assert.equal(main('999999999999+1='), '1e12')
  assert.equal(main('999999999999+0='), '999,999,999,999')
  assert.equal(main('1/1000000/1000000='), '0.000000000001')
  assert.equal(main('1/1000000/10000000='), '1e-13')
  assert.equal(main('1/7/100000='), '0.000001428571')
  assert.equal(main('1/7/10000000000='), '0.000000000014', 'fixed 12 decimals, like a 12-digit calculator')
  assert.equal(main('n1/3='), '-0.333333333333')
  // Overflow is an error.
  let s = run('999999999999*999999999999=')
  for (let i = 0; i < 7; i++) s = run('*999999999999=', s)
  assert.equal(c.mainText(s), 'Error', '>= 1e100 is an error')
})

test('the full value is kept for the next step, not the short display', () => {
  // 123456789*1000000 = 1.23456789e14, shown as 1.234568e14
  assert.equal(main('123456789*1000000=/1000000='), '123,456,789')
})

test('results near 1 do not end in a point', () => {
  assert.equal(c.roundValue(0.9999999999999), '1')
  assert.equal(c.roundValue(-0.9999999999999), '-1')
  assert.equal(c.roundValue(0.1 + 0.2), '0.3')
  assert.equal(c.roundValue(-0), '0')
  assert.equal(c.roundValue(Infinity), null)
  assert.equal(c.roundValue(NaN), null)
})

test('AC clears everything', () => {
  const s = run('2+3*C')
  assert.deepEqual(s, c.newCalc())
})

test('isClear: only when AC would have nothing to clear', () => {
  assert.equal(c.isClear(c.newCalc()), true)
  assert.equal(c.isClear(run('2+3*C')), true)
  for (const keys of ['5', '0.', '5+', '5-5=', '8/0=', '7<', '0=']) {
    assert.equal(c.isClear(run(keys)), keys === '7<' || keys === '0=', keys)
  }
  assert.equal(c.isClear(c.press(c.newCalc(), 'neg')), false, '-0')
  assert.equal(c.isClear(c.deserialize(c.serialize(c.newCalc()))), true, 'after a relaunch')
})

test('backspace', () => {
  assert.equal(main('123<'), '12')
  assert.equal(main('1<'), '0')
  assert.equal(main('1<<'), '0')
  assert.equal(main('1.5<'), '1.')
  assert.equal(main('1.5<<'), '1')
  assert.equal(main('n5<'), '0', '"-5" back to 0')
  // Into the op: the op goes and the number before it is editable again.
  assert.equal(expr('12+<'), '')
  assert.equal(main('12+<'), '12')
  assert.equal(main('12+<3'), '123')
  // Digits after an op: back to 0, then the op goes.
  assert.equal(main('12+5<'), '0')
  assert.equal(expr('12+5<'), '12+')
  assert.equal(expr('12+5<<'), '')
  assert.equal(main('12+5<<'), '12')
  // A result is cleared whole; after = it's a full clear.
  assert.deepEqual(run('2+3=<'), c.newCalc())
  assert.equal(main('50%<'), '0')
  // Nothing to delete.
  assert.deepEqual(run('<'), c.newCalc())
})

test('± (negate)', () => {
  assert.equal(main('5n'), '-5')
  assert.equal(main('5nn'), '5')
  assert.equal(main('n'), '-0')
  assert.equal(main('n5'), '-5')
  assert.equal(main('n.5'), '-0.5')
  assert.equal(main('5*n3='), '-15', 'negative number after an op')
  assert.equal(expr('5*n3'), '5×')
  assert.equal(main('5*n3'), '-3')
  assert.equal(main('2+3=n'), '-5', 'negates a result')
  assert.equal(expr('2+3=n'), '', 'and the old expression no longer matches')
  assert.equal(main('2+3=n*2='), '-10')
  assert.equal(main('2+3=n7'), '7', 'typing replaces a computed value')
  assert.equal(main('2-2=n'), '0', 'no -0 result')
  assert.equal(main('5n+1='), '-4')
  assert.equal(expr('5n+'), '-5+')
})

test('% divides the current number by 100', () => {
  assert.equal(main('50%'), '0.5')
  assert.equal(main('200*15%='), '30')
  assert.equal(main('50%%'), '0.005')
  assert.equal(main('50%3'), '3', 'typing replaces it')
  assert.equal(main('2+3=%'), '0.05')
  assert.equal(main('5+%'), '5', 'nothing to apply it to while an op is pending')
  assert.equal(expr('5+%'), '5+')
  assert.equal(main('.1%'), '0.001')
  assert.equal(main('0.000000001%'), '0.00000000001')
})

test('an expression holds at most MAX_OPS operators', () => {
  let s = c.newCalc()
  for (let i = 0; i < 30; i++) s = run('1+', s)
  assert.equal(s.tokens.length, c.MAX_OPS * 2)
  // Ops beyond the limit are ignored, so the digits after them join the
  // last number.
  assert.equal(c.mainText(s), '1,111,111,111')
  let t = c.newCalc()
  for (let i = 0; i < c.MAX_OPS; i++) t = run('1+', t)
  t = run('1+1=', t)
  assert.equal(c.mainText(t), '31', 'the 21st + is ignored, so 1 and 1 join as 11')
})

test('fitText shrinks first, then cuts the start', () => {
  const sizes = [44, 36, 30, 25, 20]
  assert.deepEqual(c.fitText('123', sizes, 184), { text: '123', size: 44 })
  assert.equal(c.fitText('1,234,567', sizes, 184).size, 36)
  assert.equal(c.fitText('123,456,789,012', sizes, 184).size, 20)
  const long = c.fitText('9'.repeat(40), sizes, 184)
  assert.equal(long.size, 20)
  assert.ok(long.text.startsWith('…'))
  assert.ok(long.text.endsWith('9999'))
  assert.ok(c.textWidth(long.text, 20) <= 184)
  // every size step is used somewhere
  const used = new Set()
  for (let n = 1; n <= 16; n++) used.add(c.fitText('8'.repeat(n), sizes, 184).size)
  assert.deepEqual([...used].sort((a, b) => b - a), sizes)
})

test('the longest possible main lines fit at the smallest size without cutting', () => {
  const sizes = [44, 36, 30, 25, 20]
  for (const keys of ['n123456789012', 'n123456789012.', 'n12345678901.2', 'n0.12345678901', '8/0=']) {
    const t = c.mainText(run(keys))
    const f = c.fitText(t, sizes, 184)
    assert.ok(!f.text.startsWith('…'), keys + ' -> ' + t + ' was cut')
  }
  for (const v of [-1.234567e-99, -9.999999e99, -1.234567e21]) {
    const t = c.fmtNumber(c.roundValue(v))
    assert.ok(!c.fitText(t, sizes, 184).text.startsWith('…'), t)
  }
})

test('serialize / deserialize round trip', () => {
  for (const keys of ['', '12', '2+3*', '2+3*4', '2+3=', '8/0=', 'n', '50%', '5*n', '1.']) {
    const s = run(keys)
    assert.deepEqual(c.deserialize(c.serialize(s)), s, keys)
  }
})

test('corrupt or foreign saved state gives a fresh calculator', () => {
  const fresh = c.newCalc()
  for (const bad of [
    '', '{not json', 'null', '[]', '42', '{"v":2}',
    '{"v":1,"t":["1"],"e":"2","l":false,"h":null,"x":false}', // no trailing op
    '{"v":1,"t":["1","%"],"e":"2","l":false,"h":null,"x":false}', // bad op
    '{"v":1,"t":["abc","+"],"e":"2","l":false,"h":null,"x":false}',
    '{"v":1,"t":[],"e":"2x","l":false,"h":null,"x":false}',
    '{"v":1,"t":[],"e":null,"l":false,"h":null,"x":false}', // nothing at all
    '{"v":1,"t":"1+","e":"2","l":false,"h":null,"x":false}'
  ]) {
    assert.deepEqual(c.deserialize(bad), fresh, bad)
  }
  assert.deepEqual(c.deserialize(undefined), fresh)
})

test('AC streak counts AC presses in a row', () => {
  let n = 0
  for (const k of ['ac', 'ac', '3', 'ac', 'ac', 'ac', 'ac']) n = c.nextAcStreak(n, k)
  assert.equal(n, 4)
  assert.equal(c.nextAcStreak(n, 'ac'), c.SECRET_AC_PRESSES)
  assert.equal(c.nextAcStreak(n, 'back'), 0)
  assert.equal(c.nextAcStreak(n, 'ops'), 0, 'page flips break it too')
  assert.equal(c.nextAcStreak(n, 'digits'), 0)
})

test('= again repeats the last operation', () => {
  assert.equal(main('2+3=='), '8')
  assert.equal(main('2+3==='), '11')
  assert.equal(expr('2+3=='), '5+3=')
  assert.equal(expr('2+3==='), '8+3=')
  assert.equal(main('10-2=='), '6')
  assert.equal(main('2*3==='), '54')
  assert.equal(main('64/2=='), '16')
  // With precedence the last op and its number repeat, not the whole tail.
  assert.equal(main('2+3*4='), '14')
  assert.equal(main('2+3*4=='), '56')
  assert.equal(expr('2+3*4=='), '14\u00d74=')
  // A negative operand repeats as negative.
  assert.equal(main('5*n2=='), '20')
  assert.equal(main('5-n2=='), '9')
  // Repeats stay free of float noise.
  assert.equal(main('.1+.2==='), '0.7')
  assert.equal(main('1/3=='), '0.111111111111')
  // Overflow along the way is an error, and = on an error stays an error.
  let s = run('999999999999*999999999999=')
  for (let i = 0; i < 7; i++) s = run('=', s)
  assert.equal(c.mainText(s), 'Error')
  assert.equal(c.mainText(run('=', s)), 'Error')
  // Nothing to repeat.
  assert.equal(main('7=='), '7')
  assert.equal(main('5+=='), '5')
  assert.equal(expr('5+=='), '5=')
  // After an op, or a new number, = evaluates normally again.
  assert.equal(main('2+3==*2='), '16')
  assert.equal(main('2+3==9='), '9')
  assert.equal(main('2+3==9+1=='), '11')
  // ± or % on the result ends the repeat (the expression line clears).
  assert.equal(main('2+3=n='), '-5')
  assert.equal(main('2+3=%='), '0.05')
})

test('the repeat survives a save and restore', () => {
  const s = c.deserialize(c.serialize(run('2+3=')))
  assert.equal(c.mainText(run('=', s)), '8')
})
