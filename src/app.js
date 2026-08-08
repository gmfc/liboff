/** Bootstrap: wire the store, the router, the tab bar and the service worker. */

import { h, icon, mount, qs } from './ui/dom.js';
import * as store from './lib/store.js';
import { defineRoute, currentPath, navigate, startRouter } from './router.js';
import { renderLibrary } from './views/library.js';
import { renderScan } from './views/scan.js';
import { renderStats } from './views/stats.js';
import { applyTheme, renderSettings } from './views/settings.js';
import { onInstallChange, watchInstall } from './install.js';
import { registerServiceWorker } from './update.js';
import { closeBookSheet } from './views/book-sheet.js';

const TABS = [
  { path: '/library', label: 'Library', icon: 'library' },
  { path: '/scan', label: 'Scan', icon: 'scan' },
  { path: '/stats', label: 'Stats', icon: 'stats' },
  { path: '/more', label: 'More', icon: 'more' },
];

function renderTabBar(active) {
  return h(
    'nav',
    { class: 'tabbar', 'aria-label': 'Main' },
    ...TABS.map((tab) =>
      h(
        'a',
        {
          class: ['tabbar__item', active === tab.path ? 'is-on' : ''],
          href: `#${tab.path}`,
          'aria-current': active === tab.path ? 'page' : null,
          dataset: { tab: tab.path.slice(1) },
        },
        icon(tab.icon, { size: 22 }),
        h('span', { class: 'tabbar__label' }, tab.label),
      ),
    ),
  );
}

function renderOfflineBanner() {
  const banner = h(
    'div',
    { class: 'offline-banner' },
    icon('offline', { size: 16 }),
    h('span', {}, 'Offline — your library still works; lookups will wait.'),
  );
  const sync = () => {
    banner.hidden = store.state.online;
  };
  sync(); // reflect the state we already have, rather than waiting for a change
  store.subscribe(sync);
  return banner;
}

async function main() {
  const root = qs('#app');
  const outlet = h('main', { class: 'outlet', id: 'main' });
  const tabbarSlot = h('div', { class: 'tabbar-slot' });

  mount(
    root,
    h(
      'header',
      { class: 'appbar' },
      h('span', { class: 'appbar__brand' }, 'liboff'),
      h('span', { class: 'appbar__tag' }, 'your shelf, offline'),
    ),
    renderOfflineBanner(),
    outlet,
    tabbarSlot,
  );

  defineRoute('/library', renderLibrary);
  defineRoute('/scan', renderScan);
  defineRoute('/stats', renderStats);
  defineRoute('/more', renderSettings);

  watchInstall();
  store.watchConnectivity();
  onInstallChange(() => store.notify());

  await store.init();
  applyTheme(store.state.theme);

  startRouter(outlet, {
    onNavigate: (path) => {
      mount(tabbarSlot, renderTabBar(path));
      closeBookSheet();
    },
  });
  mount(tabbarSlot, renderTabBar(currentPath()));

  document.body.classList.add('is-ready');
  registerServiceWorker();
}

// Deep links such as #/scan should work from a home-screen shortcut.
window.addEventListener('hashchange', () => {
  if (!window.location.hash) navigate('/library', { replace: true });
});

main().catch((error) => {
  console.error(error);
  const root = qs('#app');
  mount(
    root,
    h(
      'div',
      { class: 'fatal' },
      h('h1', {}, 'liboff could not start'),
      h('p', {}, String(error?.message ?? error)),
      h('button', { class: 'btn btn--primary', onClick: () => location.reload() }, 'Try again'),
    ),
  );
});
