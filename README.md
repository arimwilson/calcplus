# Calc+ for Xiaomi Smart Band 10

A basic calculator as a Vela JS quick app (`.rpk`) for the Xiaomi Smart Band
10 (212 x 520 capsule screen, `designWidth` 212), styled after HyperOS's own
apps: pure black, the system font, white digits on dark grey rounded keys,
orange operators and a filled orange `=`.

Named **Calc+** so it can't clash with a built-in Calculator. I found no sign
that the Band 10 ships one, but couldn't check Xiaomi's own docs from the
build machine.

## What it does

- Two pages, so the keys can be bigger. The Band 10 screen is only about
  16.5 mm wide (1 px ≈ 0.078 mm), so four columns can't get past about 4 mm
  per key.
  - **Digit page** (3×4): `7 8 9 / 4 5 6 / 1 2 3 / [+−×÷] 0 =`. Keys are
    61×79 px, about 4.8×6.2 mm.
  - **Operator page** (2×5): `+ − / × ÷ / . ⌫ / ± % / 123 AC`. Keys are
    94×62 px, about 7.4×4.8 mm.
  - The orange `+−×÷` key flips to the operator page, and `123`, in the same
    bottom-left spot, flips back without doing anything, so one spot toggles
    the pages. Every other key there flips back to the digits after doing
    its job, except `⌫`, which stays so you can delete several digits, and
    AC when there's nothing left to clear, so it can be pressed again.
  - Each key's whole grid cell, gaps included, is its touch target.
  - The app always opens on the digit page.
  - `128+3×45=` takes 11 taps: one extra per operator, and for `.`.
- Standard precedence: `2+3×4 = 14`. Same-level operators go left to right.
- The grey line shows the expression; the large line shows the number being
  typed, or the result after `=` (the grey line then ends in `=`).
- After `=`, an operator keeps calculating from the result; a digit starts
  over.
- Pressing `=` again repeats the last operation on the result: `2+3=` gives
  5, then `=` gives 8, 11, 14 … The last operation is the last operator and
  the number after it, so `2+3×4=` (14) repeats as `×4` (56). The grey line
  shows each step (`5+3=`). After `7=` or `5+=` there's nothing to repeat.
  `±` or `%` on a result ends the repeat. The repeat survives a relaunch.
- Two operators in a row: the second replaces the first. `5+=` gives 5.
- `÷ 0` shows a red **Error**. Any digit, AC or ⌫ clears it; operators are
  ignored until then. Results of 1e100 or more are an error too.
- Results are rounded to 12 significant digits, so `0.1+0.2 = 0.3`. Small
  results get at most 12 decimals (`1÷3 = 0.333333333333`). Results from
  1e12 up, or below 0.000000000001, are shown with a 7-digit mantissa
  (`1.219326e17`), and the full 12-digit value is kept for the next step.
- Limits: 12 digits per number (the 0 in `0.5` doesn't count), 20 operators
  per expression (more are ignored).
- `±` negates the current number. Pressed right after an operator, it starts
  a negative number: `5 × ± 3 = −15`.
- `%` divides the current number by 100: `200 × 15 % = 30`.
- `⌫` deletes the last digit. On an empty number it removes the operator
  before it, and the number before that becomes editable again. On a
  computed value (after `%` or `±` on a result) it clears the whole value;
  after `=` it clears everything.
- Both lines are centred in the top of the screen. Right-aligned text there
  would run into the rounded corners.
- Long numbers shrink the large line through 40 / 34 / 28 / 24 / 20 px. The
  widest number the 12-digit limit allows (`-99,999,999,999.9`) still fits
  at 20 px. A long expression cuts its start off, shown as `…`.
- Keys light up while held (via touchstart/touchend, because the toolkit
  rejects `:active`).
- State is saved on every key press and restored on launch, so it survives
  the band killing the app.
- Secret: press AC five times in a row and the display shows "Made with
  love / by Ari Wilson." From a cleared calculator that's `+−×÷`, then AC
  five times. If the first AC clears something, it flips back to the digits
  as usual: tap `+−×÷` and AC five more times. Any other key in between,
  page flips included, restarts the count. The next key press dismisses it
  and still does its job. It isn't saved, so it's gone after a relaunch.

`−` on its keys is a drawn bar, and `⌫` is a small PNG, because the band's
font may lack U+2212 and U+232B. In the expression and result lines, minus is
the ASCII hyphen for the same reason.

## Install on the band

Install the debug package from `npm run build`:
`dist/com.ariwilson.bandcalc.debug.2.1.0.rpk`. It's the only kind that can
be sideloaded; don't use `aiot release`.

Pick one (all unofficial; Xiaomi offers no public sideload):

1. **Notify for Xiaomi** (Android, already paired with the band): copy the
   `.rpk` to the phone, open it with Notify (keep the `.rpk` extension), check
   it says "Valid app file", tap **Install**, and wait for "Update completed".
   This path is documented working on a Band 10 (firmware 3.2.8) with Notify
   23.9.0 and an aiot-toolkit 2.0.5 debug build
   (github.com/mhdbaselar/xiaomi-band-development, docs/deployment-notify.md).
2. **AstroBox** (astrobox.online): it needs a Mi account login. Force-stop Mi
   Fitness first, or the Bluetooth connection fails with GATT error 133. Band
   10 support is unconfirmed.
3. **Mi Fitness's hidden debug page**, reached over ADB: see
   github.com/mhdbaselar/xiaomi-band-development, docs/deployment-real-device.md.

Then open the app list on the band and look for **Calc+**. To update, bump
`versionCode` and `versionName` in `src/manifest.json` and rebuild. Keep the
`package` name (`com.ariwilson.bandcalc`) the same, or the saved state is
lost.

## Build and test

```sh
npm install
npm run build      # -> dist/*.debug.*.rpk
npm test           # unit tests + UI tests (needs Playwright + Chromium)
```

- `test/calc.test.mjs` tests the calculator logic in `src/common/calc.js`,
  which imports no system modules, so it runs under plain Node.
- `test/ui.test.mjs` loads the **compiled** page from `build/` into headless
  Chromium through `test/harness/`, a small stand-in for the Vela runtime.
  The harness implements the template builtins the compiler emits, the
  compiled style table, a stubbed `@system.storage` backed by localStorage,
  and maps touchstart/touchend/touchcancel to pointer events. The tests tap
  real keys, flipping pages as a person would, and check:
  - results, pressed states, page flips and tap counts;
  - that the touch cells tile the keypad with no gaps;
  - persistence across a kill, and corrupt saved state.

  On every screenshot they also check that:
  - nothing is off-screen;
  - nothing spills out of its parent;
  - no text overflows its box;
  - nothing drawn reaches the capsule's rounded corners. In the top and
    bottom 106 px, every point must lie within 103 px of the corner centre,
    and in between at least 8 px from the sides. Every background's rounded
    outline, every image's box and every text line box is sampled.

  One test breaks the layout on purpose to show that each check fires.
  Screenshots go to `test/screens/`.

`tools/` has the PIL scripts that draw `logo.png` and `back.png`
(`python3 tools/draw_icons.py src/common`) and build the contact sheet
(`python3 tools/contact_sheet.py test/screens contact-sheet.png`), plus
`tools/capsule-slack.mjs`, which prints how close each element comes to the
rounded edge.

The harness is not the band. Layout uses Chromium's flexbox and fonts, not
Vela's renderer and MiSans.

## Known limits

- Never run on Vela itself: not on a band, not in the emulator.
- Fonts: the font size is picked from a width estimate of 0.6 em per digit.
  That fits with room to spare in Chromium's font here (Inter), but MiSans
  is untested. Text may also sit a little higher or lower in the keys and
  lines on the band.
- Tightest spots on the screen: the bottom outer keys are 7.8 px (operator
  page) and 8.3 px (digit page) from the screen's rounded edge, and the end
  of a long expression line is 9.1 px.
- Pages flip on the click, after the finger lifts, so the lifting finger
  can't also press the key that appears under it. In the harness, that is.
  On the band it depends on Vela firing click after touchend, as it should.
- The pressed highlight depends on the band firing touchstart and touchend
  on a key. If a press leaves a key lit, the next press clears it.
- No haptics, so the app needs only `system.storage`. A short buzz per key
  is easy to add.
