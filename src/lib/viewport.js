/**
 * What the browser thinks the screen is.
 *
 * A phone has several rectangles that all get called "the viewport" and do not
 * agree: the layout viewport a fixed element is positioned against, the visual
 * viewport you can actually see, and the safe area inside the rounded corners,
 * notch and home indicator. Which of them a CSS length resolves to is not
 * something you can reason out from a screenshot — this app has now guessed
 * wrong about it twice — so the numbers are read out instead.
 *
 * Nothing here is diagnostic-only cleverness: it is four `getBoundingClientRect`
 * calls and a probe element, and it is the difference between fixing a layout
 * and redecorating it.
 */

/**
 * Resolve the four safe-area insets by asking the browser to apply them.
 *
 * `env()` cannot be read from JavaScript, so a throwaway element takes them as
 * padding and the computed style is read back. Zero everywhere means either a
 * device without insets or, more usefully, that `viewport-fit=cover` is not in
 * effect — the two look identical from here, which is itself worth knowing.
 */
export function safeAreaInsets() {
  if (typeof document === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
  const probe = document.createElement('div');
  probe.style.cssText = [
    'position:fixed',
    'visibility:hidden',
    'pointer-events:none',
    'top:0;left:0;width:0;height:0',
    'padding-top:env(safe-area-inset-top)',
    'padding-right:env(safe-area-inset-right)',
    'padding-bottom:env(safe-area-inset-bottom)',
    'padding-left:env(safe-area-inset-left)',
  ].join(';');
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const read = (side) => Math.round(parseFloat(style.getPropertyValue(`padding-${side}`)) || 0);
  const insets = {
    top: read('top'),
    right: read('right'),
    bottom: read('bottom'),
    left: read('left'),
  };
  probe.remove();
  return insets;
}

/** Everything worth knowing about where the app shell actually sits. */
export function viewportReport() {
  const shell = document.querySelector('#app')?.getBoundingClientRect();
  const bar = document.querySelector('.tabbar')?.getBoundingClientRect();
  const visual = window.visualViewport;
  return {
    layout: { width: window.innerWidth, height: window.innerHeight },
    visual: visual ? { width: Math.round(visual.width), height: Math.round(visual.height) } : null,
    screen: { width: window.screen?.width ?? 0, height: window.screen?.height ?? 0 },
    dpr: window.devicePixelRatio ?? 1,
    insets: safeAreaInsets(),
    shell: shell ? { top: Math.round(shell.top), bottom: Math.round(shell.bottom), height: Math.round(shell.height) } : null,
    barBottom: bar ? Math.round(bar.bottom) : null,
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true,
  };
}

/**
 * The one number this was built to answer: how far the bottom of the app is
 * from the bottom of the layout viewport. Anything but zero is a strip of
 * nothing under the tab bar.
 */
export function shellGap(report) {
  if (!report?.shell) return null;
  return report.layout.height - report.shell.bottom;
}

/** A form that can be read aloud, or pasted into a bug report. */
export function formatViewportReport(report) {
  if (!report) return '';
  const { layout, visual, screen, insets, shell } = report;
  const gap = shellGap(report);
  return [
    `layout   ${layout.width}×${layout.height}`,
    `visual   ${visual ? `${visual.width}×${visual.height}` : 'unavailable'}`,
    `screen   ${screen.width}×${screen.height} @${report.dpr}x`,
    `insets   top ${insets.top}  right ${insets.right}  bottom ${insets.bottom}  left ${insets.left}`,
    `shell    top ${shell?.top ?? '?'}  bottom ${shell?.bottom ?? '?'}  height ${shell?.height ?? '?'}`,
    `tab bar  bottom ${report.barBottom ?? '?'}`,
    `gap      ${gap === null ? '?' : gap}`,
    `mode     ${report.standalone ? 'installed' : 'browser'}`,
  ].join('\n');
}
