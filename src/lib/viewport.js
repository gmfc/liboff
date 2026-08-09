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

/**
 * How much taller than the layout viewport the shell has to be to reach the
 * bottom of the screen. Zero almost everywhere.
 *
 * A home-screen app on iOS with a translucent status bar paints the whole
 * screen, but reports a layout viewport shorter than it by exactly the height
 * of the status bar — measured on an iPhone: screen 874, `innerHeight` 812,
 * `env(safe-area-inset-top)` 62. Every length that resolves against that
 * viewport is short by the same 62: `100%`, `vh`, `dvh`, and the containing
 * block of a `position: fixed` element alike. Which is why three attempts at
 * this in a row moved the tab bar to a bottom edge that was itself in the
 * wrong place, and why the app could report a gap of zero while a strip of
 * nothing sat under it.
 *
 * Deliberately narrow. It fires only for that exact signature — installed, a
 * top inset, and a deficit matching it — and returns zero for anything else,
 * including a browser tab, where the viewport is short by the browser's own
 * furniture and extending the shell would push the tab bar off the screen.
 *
 * @param {{standalone: boolean, screenWidth: number, screenHeight: number,
 *          innerWidth: number, innerHeight: number, insetTop: number}} metrics
 */
export function shellExtension(metrics) {
  const { standalone, screenWidth, screenHeight, innerWidth, innerHeight, insetTop } = metrics;
  if (!standalone || !insetTop) return 0;

  // `screen` keeps its portrait orientation on iOS, so pick the edge that
  // matches how the app is currently held rather than trusting the order.
  const longEdge = Math.max(screenWidth, screenHeight);
  const shortEdge = Math.min(screenWidth, screenHeight);
  const visible = innerHeight >= innerWidth ? longEdge : shortEdge;

  const deficit = visible - innerHeight;
  // Within a pixel or two, because these are CSS pixels off a 3x screen.
  return Math.abs(deficit - insetTop) <= 2 ? insetTop : 0;
}

/**
 * Publish the extension as a custom property for the stylesheet to add to the
 * shell's height. Re-run whenever the viewport changes, since rotating the
 * device changes which screen edge is the visible one.
 */
export function applyShellExtension() {
  const extra = shellExtension({
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true,
    screenWidth: window.screen?.width ?? 0,
    screenHeight: window.screen?.height ?? 0,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    insetTop: safeAreaInsets().top,
  });
  document.documentElement.style.setProperty('--shell-extra', `${extra}px`);
  return extra;
}

export function watchShellExtension() {
  applyShellExtension();
  window.addEventListener('resize', applyShellExtension);
  window.addEventListener('orientationchange', applyShellExtension);
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
    extra: Math.round(
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shell-extra')) || 0,
    ),
    standalone:
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true,
  };
}

/**
 * The one number this was built to answer: how far the bottom of the app is
 * from the bottom of the screen. Anything but zero is a strip of nothing
 * under the tab bar.
 *
 * Measured against the layout viewport *plus* any extension, because on the
 * phone where this was chased the layout viewport was itself 62px short of
 * the screen — so a gap of zero against it was true and useless.
 */
export function shellGap(report) {
  if (!report?.shell) return null;
  return report.layout.height + (report.extra ?? 0) - report.shell.bottom;
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
    `extra    ${report.extra ?? 0}`,
    `gap      ${gap === null ? '?' : gap}`,
    `mode     ${report.standalone ? 'installed' : 'browser'}`,
  ].join('\n');
}
