/**
 * Settings: backup, restore, appearance, storage, about.
 *
 * The library lives on this device and nowhere else, which makes export the
 * single most important control in the app — it is placed first for that
 * reason.
 */

import { formatNumber, h, icon, mount } from '../ui/dom.js';
import { confirmDialog, toast } from '../ui/toast.js';
import { exportCsv, exportJson, mergeImport, parseImportFile } from '../lib/transfer.js';
import { isPersistent, requestPersistence, storageEstimate } from '../lib/db.js';
import * as store from '../lib/store.js';
import { getInstallPrompt, isStandalone } from '../install.js';
import { checkNow, isSupported } from '../update.js';

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

function row(title, description, control, descriptionNode = null) {
  return h(
    'div',
    { class: 'setting' },
    h(
      'div',
      { class: 'setting__text' },
      h('span', { class: 'setting__title' }, title),
      description ? h('span', { class: 'setting__desc' }, description) : null,
      descriptionNode,
    ),
    control,
  );
}

export function renderSettings(container) {
  const root = h('div', { class: 'view view--settings' });
  const storageLine = h('span', { class: 'setting__desc' }, 'Checking…');

  storageEstimate().then((estimate) => {
    if (!estimate?.usage) {
      storageLine.textContent = isPersistent()
        ? 'Stored on this device.'
        : 'Storage is unavailable — this session will not be saved.';
      return;
    }
    const mb = (estimate.usage / 1024 / 1024).toFixed(1);
    storageLine.textContent = `${mb} MB used on this device${isPersistent() ? '' : ' (not persisted)'}.`;
  });

  const importInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'visually-hidden',
    onChange: async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      try {
        const payload = parseImportFile(await file.text());
        const result = mergeImport(store.state.books, payload, {
          collections: store.state.collections,
        });
        await store.replaceLibrary(result.books, result.collections);
        const collectionNote = result.collectionsAdded
          ? `, ${result.collectionsAdded} collection${result.collectionsAdded === 1 ? '' : 's'}`
          : '';
        toast(
          `Imported: ${result.added} added, ${result.updated} updated, ${result.skipped} unchanged${collectionNote}.`,
          { duration: 4200 },
        );
      } catch (error) {
        toast(error.message ?? 'That file could not be imported.', { kind: 'warn', duration: 5000 });
      }
    },
  });

  function render() {
    const installPrompt = getInstallPrompt();
    mount(
      root,
      h('h1', { class: 'view__title' }, 'More'),

      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, 'Backup'),
        h(
          'p',
          { class: 'section__hint' },
          'Your library is stored only on this device. Export it now and again so a lost phone is not a lost catalogue.',
        ),
        h(
          'div',
          { class: 'button-row' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--primary',
              onClick: () => {
                download(
                  `liboff-${stamp()}.json`,
                  exportJson(store.state.books, store.state.collections),
                  'application/json',
                );
                toast('Library exported');
              },
            },
            icon('download', { size: 18 }),
            'Export JSON',
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--ghost',
              onClick: () => {
                download(
                  `liboff-${stamp()}.csv`,
                  exportCsv(store.state.books, store.state.collections),
                  'text/csv',
                );
              },
            },
            'Export CSV',
          ),
          h(
            'button',
            { type: 'button', class: 'btn btn--ghost', onClick: () => importInput.click() },
            icon('upload', { size: 18 }),
            'Import',
          ),
        ),
        importInput,
      ),

      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, 'App'),
        !isStandalone() && installPrompt
          ? row(
              'Install liboff',
              'Add it to your home screen so it opens full screen and works offline.',
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--primary',
                  onClick: async () => {
                    await installPrompt();
                    render();
                  },
                },
                icon('install', { size: 18 }),
                'Install',
              ),
            )
          : row(
              isStandalone() ? 'Installed' : 'Install liboff',
              isStandalone()
                ? 'Running as an installed app.'
                : 'Use your browser menu — “Add to Home Screen” — to install.',
              null,
            ),
        row(
          'Theme',
          'Match your device, or pin it.',
          h(
            'div',
            { class: 'segmented segmented--small' },
            ...[
              { id: 'system', label: 'Auto' },
              { id: 'light', label: 'Light' },
              { id: 'dark', label: 'Dark' },
            ].map((option) =>
              h(
                'button',
                {
                  type: 'button',
                  class: ['segmented__item', store.state.theme === option.id ? 'is-on' : ''],
                  'aria-pressed': String(store.state.theme === option.id),
                  onClick: () => {
                    store.setPreference('theme', option.id);
                    applyTheme(option.id);
                  },
                },
                option.label,
              ),
            ),
          ),
        ),
        isSupported()
          ? row(
              'Version',
              'The app updates itself in the background. This asks now.',
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--ghost',
                  dataset: { testid: 'check-update' },
                  onClick: async (event) => {
                    const button = event.currentTarget;
                    button.disabled = true;
                    button.textContent = 'Checking…';
                    const outcome = await checkNow();
                    button.disabled = false;
                    button.textContent = 'Check now';
                    if (outcome.state === 'updated') {
                      toast(
                        `Updated ${outcome.changed} file${outcome.changed === 1 ? '' : 's'} — reloading.`,
                        { duration: 2000 },
                      );
                      // Long enough to read, short enough not to be a wait.
                      setTimeout(() => location.reload(), 900);
                      return;
                    }
                    if (outcome.state === 'offline') {
                      toast('Could not reach the server to check.', { kind: 'warn' });
                      return;
                    }
                    toast('You are on the latest version.');
                  },
                },
                'Check now',
              ),
            )
          : null,
        row('Storage', null, null, storageLine),
        !isPersistent()
          ? null
          : row(
              'Keep my data',
              'Ask the browser not to clear the library when space runs low.',
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn btn--ghost',
                  onClick: async () => {
                    const granted = await requestPersistence();
                    toast(
                      granted
                        ? 'Your library is now marked as persistent.'
                        : 'The browser declined — export a backup instead.',
                      { kind: granted ? 'info' : 'warn' },
                    );
                  },
                },
                'Request',
              ),
            ),
      ),

      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, 'Lookups'),
        h(
          'p',
          { class: 'section__hint' },
          'Open Library and Crossref need nothing. Google Books rations callers who bring no key of their own, against a single quota shared by every app that does the same — when it runs dry, that catalogue goes quiet for everyone at once. A key of your own is a quota of your own, and stays on this device.',
        ),
        h('input', {
          class: 'input',
          type: 'text',
          autocomplete: 'off',
          autocapitalize: 'off',
          spellcheck: 'false',
          placeholder: 'Google Books API key (optional)',
          'aria-label': 'Google Books API key',
          value: store.state.googleBooksKey,
          dataset: { testid: 'google-key' },
          onChange: async (event) => {
            await store.setGoogleKey(event.target.value);
            toast(event.target.value.trim() ? 'Key saved — lookups will use it.' : 'Key removed.');
          },
        }),
      ),

      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, 'Danger zone'),
        row(
          'Erase library',
          `Delete all ${formatNumber(store.state.books.length)} books and cached covers from this device.`,
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--danger',
              onClick: async () => {
                const confirmed = await confirmDialog({
                  title: 'Erase your whole library?',
                  body: 'Every book, rating and note on this device will be deleted. This cannot be undone.',
                  confirmLabel: 'Erase everything',
                });
                if (!confirmed) return;
                await store.clearLibrary();
                toast('Library erased');
              },
            },
            'Erase',
          ),
        ),
      ),

      h(
        'section',
        { class: 'section section--about' },
        h('h2', { class: 'section__title' }, 'About'),
        h(
          'p',
          { class: 'section__hint' },
          'liboff catalogues books offline. Nothing leaves your device except ISBN lookups to Open Library, Google Books and Crossref.',
        ),
        h(
          'p',
          { class: 'section__hint' },
          'Barcode decoding on browsers without the native Barcode Detection API uses zbar-wasm (LGPL-2.1-or-later), bundled unmodified in vendor/zbar-wasm.',
        ),
        h(
          'p',
          { class: 'section__hint' },
          'Cover art and metadata come from Open Library, Google Books and Crossref.',
        ),
      ),
    );
  }

  mount(container, root);
  render();
  return store.subscribe(render);
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.dataset.theme = theme;
  } else {
    delete root.dataset.theme;
  }
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) {
    const dark =
      theme === 'dark' ||
      (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    meta.setAttribute('content', dark ? '#14110d' : '#faf6ef');
  }
}
