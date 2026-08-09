import test from 'node:test';
import assert from 'node:assert/strict';

import { formatViewportReport, shellGap } from '../../src/lib/viewport.js';

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

test('a browser without visualViewport says so rather than printing nothing', () => {
  assert.match(formatViewportReport(report({ visual: null })), /visual {3}unavailable/);
});

test('formatting an absent report is empty, not a crash', () => {
  assert.equal(formatViewportReport(null), '');
});
