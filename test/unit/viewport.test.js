import test from 'node:test';
import assert from 'node:assert/strict';

import { formatViewportReport, shellExtension, shellGap } from '../../src/lib/viewport.js';

/* --------------------------------------------------- the shell extension */

/** The phone this was chased on: an installed app, screen 402×874. */
const iphoneInstalled = {
  standalone: true,
  screenWidth: 402,
  screenHeight: 874,
  innerWidth: 402,
  innerHeight: 812,
  insetTop: 62,
};

test('an installed iOS app short by its status bar is extended by exactly that', () => {
  // 874 − 812 = 62, and the top inset is 62. The layout viewport is the thing
  // in the wrong place, so no height unit resolving against it could help.
  assert.equal(shellExtension(iphoneInstalled), 62);
});

test('the same phone in a browser tab is left alone', () => {
  // Safari's viewport is short by its own furniture, and stretching the shell
  // to the screen would push the tab bar behind the toolbar.
  assert.equal(shellExtension({ ...iphoneInstalled, standalone: false }), 0);
});

test('a screen the viewport already fills is left alone', () => {
  assert.equal(shellExtension({ ...iphoneInstalled, innerHeight: 874 }), 0);
});

test('a deficit that is not the status bar is not this bug, and is not touched', () => {
  // Short by 200: some other chrome. Guessing at it is how this went wrong.
  assert.equal(shellExtension({ ...iphoneInstalled, innerHeight: 674 }), 0);
});

test('no top inset means nothing to compensate for', () => {
  assert.equal(shellExtension({ ...iphoneInstalled, insetTop: 0, innerHeight: 874 }), 0);
});

test('held sideways, the visible edge is the short one', () => {
  // `screen` keeps reporting portrait on iOS, so the code cannot just read
  // screenHeight — landscape 874×402 with the same 62 missing.
  assert.equal(
    shellExtension({ ...iphoneInstalled, innerWidth: 874, innerHeight: 340, insetTop: 62 }),
    62,
  );
});

test('a rounding pixel or two still counts as the same deficit', () => {
  assert.equal(shellExtension({ ...iphoneInstalled, innerHeight: 813 }), 62);
  assert.equal(shellExtension({ ...iphoneInstalled, innerHeight: 817 }), 0, 'five is not rounding');
});

/* ------------------------------------------------------------- the report */

const report = (overrides = {}) => ({
  layout: { width: 390, height: 844 },
  visual: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  dpr: 3,
  insets: { top: 59, right: 0, bottom: 34, left: 0 },
  shell: { top: 0, bottom: 844, height: 844 },
  barBottom: 844,
  standalone: true,
  ...overrides,
});

test('no gap when the shell reaches the bottom of the layout viewport', () => {
  assert.equal(shellGap(report()), 0);
});

test('the gap is the strip of nothing under the app, in pixels', () => {
  // The shape of the bug being chased: the shell stops short of the bottom.
  assert.equal(shellGap(report({ shell: { top: 0, bottom: 810, height: 810 } })), 34);
});

test('a shell taller than the viewport reports a negative gap, not a zero', () => {
  // Overflowing is a different fault from falling short, and rounding them
  // both to "fine" is how the previous two attempts looked like they worked.
  assert.equal(shellGap(report({ shell: { top: 0, bottom: 900, height: 900 } })), -56);
});

test('an unmeasurable shell is null rather than zero', () => {
  assert.equal(shellGap(report({ shell: null })), null);
  assert.equal(shellGap(null), null);
});

test('the report reads as numbers a person can relay', () => {
  const text = formatViewportReport(report({ shell: { top: 0, bottom: 810, height: 810 } }));
  assert.match(text, /layout {3}390×844/);
  assert.match(text, /insets {3}top 59 {2}right 0 {2}bottom 34 {2}left 0/);
  assert.match(text, /gap {6}34/);
  assert.match(text, /mode {5}installed/);
});

test('the gap is measured against the screen, not the viewport that lied', () => {
  // The shape of the phone this was chased on, once compensated: a shell
  // deliberately 62 taller than the layout viewport, reaching the screen.
  // Measured the old way this reads as -62; it is 0.
  const compensated = report({
    layout: { width: 402, height: 812 },
    extra: 62,
    shell: { top: 0, bottom: 874, height: 874 },
    barBottom: 874,
  });
  assert.equal(shellGap(compensated), 0);
  assert.match(formatViewportReport(compensated), /extra {4}62/);
});

test('a browser without visualViewport says so rather than printing nothing', () => {
  assert.match(formatViewportReport(report({ visual: null })), /visual {3}unavailable/);
});

test('formatting an absent report is empty, not a crash', () => {
  assert.equal(formatViewportReport(null), '');
});
