/**
 * Hash routing.
 *
 * The hash is used rather than the History API because the app is deployed as
 * plain static files — on GitHub Pages a deep link like /liboff/scan would 404
 * before the app ever loaded, and there is no server to rewrite it.
 */

const routes = new Map();
let current = null;
let cleanup = null;
let outlet = null;
let onChange = null;

export function defineRoute(path, render) {
  routes.set(path, render);
}

export function currentPath() {
  const hash = window.location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/library';
}

export function navigate(path, { replace = false } = {}) {
  const target = `#${path}`;
  if (window.location.hash === target) return;
  if (replace) window.history.replaceState(null, '', target);
  else window.location.hash = target;
  if (replace) render();
}

function render() {
  const path = currentPath();
  const view = routes.get(path) ?? routes.get('/library');
  if (current === path) return;
  cleanup?.();
  cleanup = null;
  current = path;
  outlet.scrollTop = 0;
  window.scrollTo(0, 0);
  cleanup = view(outlet) ?? null;
  onChange?.(path);
}

export function startRouter(element, { onNavigate } = {}) {
  outlet = element;
  onChange = onNavigate;
  window.addEventListener('hashchange', render);
  if (!window.location.hash) window.history.replaceState(null, '', '#/library');
  render();
}
