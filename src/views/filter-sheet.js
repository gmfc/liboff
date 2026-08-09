/**
 * The filter sheet: everything the library can be narrowed by, in one place.
 *
 * A sheet rather than another row of chips in the header. Tags grow without
 * limit — a few dozen is normal after a year of cataloguing — and a header
 * that grows with them steals space from the books on every screen, whether
 * or not you are filtering today.
 *
 * Collections are also managed from here, because the place you look for
 * "Book club" is the same place you go to rename it.
 */

import { h, icon, mount } from '../ui/dom.js';
import { collectionIcon, countBadge, tagLabel } from '../ui/chips.js';
import { confirmDialog, toast } from '../ui/toast.js';
import { sortCollections } from '../lib/collections.js';
import { tagCounts } from '../lib/tags.js';
import * as store from '../lib/store.js';

let openSheet = null;

export function closeFilterSheet() {
  openSheet?.close();
}

/** A small inline name prompt — used for creating and renaming collections. */
function namePrompt({ title, value = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    const input = h('input', {
      class: 'input',
      value,
      placeholder: 'Collection name',
      'aria-label': 'Collection name',
      dataset: { testid: 'collection-name' },
    });

    const dialog = h(
      'div',
      { class: 'dialog-backdrop', onClick: (event) => event.target === dialog && close(null) },
      h(
        'form',
        {
          class: 'dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
          onSubmit: (event) => {
            event.preventDefault();
            close(input.value.trim() || null);
          },
        },
        h('h2', { class: 'dialog__title' }, title),
        input,
        h(
          'div',
          { class: 'dialog__actions' },
          h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => close(null) }, 'Cancel'),
          h(
            'button',
            { type: 'submit', class: 'btn btn--primary', dataset: { testid: 'collection-save' } },
            confirmLabel,
          ),
        ),
      ),
    );

    function onKey(event) {
      if (event.key === 'Escape') close(null);
    }

    function close(result) {
      document.removeEventListener('keydown', onKey);
      dialog.remove();
      resolve(result);
    }

    document.addEventListener('keydown', onKey);
    document.body.appendChild(dialog);
    input.focus();
  });
}

export function showFilterSheet() {
  closeFilterSheet();

  const content = h('div', { class: 'sheet__content' });

  const dialog = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Filter', tabindex: '-1' },
    h(
      'div',
      { class: 'sheet__bar' },
      h(
        'button',
        {
          type: 'button',
          class: 'sheet__close',
          'aria-label': 'Close',
          dataset: { testid: 'sheet-close' },
          onClick: () => close(),
        },
        icon('close', { size: 20 }),
      ),
    ),
    content,
  );

  const backdrop = h(
    'div',
    { class: 'sheet-backdrop', onClick: (event) => event.target === backdrop && close() },
    dialog,
  );

  const previouslyFocused = document.activeElement;

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    unsubscribe();
    backdrop.classList.add('is-leaving');
    setTimeout(() => backdrop.remove(), 200);
    openSheet = null;
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus({ preventScroll: true });
    }
  }

  function collectionRow(collection) {
    const active = store.state.collectionId === collection.id;
    return h(
      'div',
      { class: ['facet-row', active ? 'is-on' : ''], dataset: { testid: 'collection-row' } },
      h(
        'button',
        {
          type: 'button',
          class: 'facet-row__main',
          'aria-pressed': String(active),
          dataset: { collection: collection.id },
          onClick: () => {
            store.setState({ collectionId: active ? null : collection.id });
            close();
          },
        },
        collectionIcon(),
        h('span', { class: 'facet-row__name' }, collection.name),
        countBadge(collection.bookIds.length),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'facet-row__action',
          'aria-label': `Rename ${collection.name}`,
          onClick: async () => {
            const name = await namePrompt({
              title: 'Rename collection',
              value: collection.name,
            });
            if (name) await store.editCollectionName(collection.id, name);
          },
        },
        icon('edit', { size: 16 }),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'facet-row__action facet-row__action--danger',
          'aria-label': `Delete ${collection.name}`,
          onClick: async () => {
            const confirmed = await confirmDialog({
              title: `Delete “${collection.name}”?`,
              body: 'The collection goes; the books in it stay in your library.',
              confirmLabel: 'Delete collection',
            });
            if (!confirmed) return;
            await store.removeCollection(collection.id);
            toast('Collection deleted');
          },
        },
        icon('trash', { size: 16 }),
      ),
    );
  }

  function tagRow({ tag, count }) {
    const active = store.state.tag === tag;
    return h(
      'div',
      { class: ['facet-row', active ? 'is-on' : ''], dataset: { testid: 'tag-row' } },
      h(
        'button',
        {
          type: 'button',
          class: 'facet-row__main',
          'aria-pressed': String(active),
          dataset: { tag },
          onClick: () => {
            store.setState({ tag: active ? null : tag });
            close();
          },
        },
        h('span', { class: 'facet-row__name' }, tagLabel(tag)),
        countBadge(count),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'facet-row__action',
          'aria-label': `Rename ${tag}`,
          onClick: async () => {
            const name = await namePrompt({ title: `Rename #${tag}`, value: tag });
            if (!name) return;
            const moved = await store.renameTag(tag, name);
            if (store.state.tag === tag) store.setState({ tag: name });
            toast(`Renamed on ${moved} book${moved === 1 ? '' : 's'}`);
          },
        },
        icon('edit', { size: 16 }),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'facet-row__action facet-row__action--danger',
          'aria-label': `Remove ${tag} from every book`,
          onClick: async () => {
            const confirmed = await confirmDialog({
              title: `Remove #${tag}?`,
              body: `It will be taken off ${count} book${count === 1 ? '' : 's'}. The books stay.`,
              confirmLabel: 'Remove tag',
            });
            if (!confirmed) return;
            const removed = await store.deleteTag(tag);
            toast(`Removed from ${removed} book${removed === 1 ? '' : 's'}`);
          },
        },
        icon('trash', { size: 16 }),
      ),
    );
  }

  function render() {
    const collections = sortCollections(store.state.collections);
    const tags = tagCounts(store.state.books);
    const filtering = store.state.collectionId || store.state.tag;

    mount(
      content,
      h(
        'div',
        { class: 'sheet__inner' },
        h(
          'section',
          { class: 'section' },
          h(
            'div',
            { class: 'section__head' },
            h('h2', { class: 'section__title' }, 'Collections'),
            h(
              'button',
              {
                type: 'button',
                class: 'link-btn',
                dataset: { testid: 'new-collection' },
                onClick: async () => {
                  const name = await namePrompt({
                    title: 'New collection',
                    confirmLabel: 'Create',
                  });
                  if (!name) return;
                  await store.createCollection(name);
                  toast(`Created “${name}”`);
                },
              },
              'New',
            ),
          ),
          collections.length
            ? h('div', { class: 'facet-list' }, ...collections.map(collectionRow))
            : h(
                'p',
                { class: 'section__hint' },
                'Collections are groups you put books into yourself — a book club, a series, the ones you keep lending out.',
              ),
        ),

        h(
          'section',
          { class: 'section' },
          h('h2', { class: 'section__title' }, 'Tags'),
          tags.length
            ? h('div', { class: 'facet-list' }, ...tags.map(tagRow))
            : h(
                'p',
                { class: 'section__hint' },
                'Tags are free-form labels. Add a few from a book’s page and they show up here.',
              ),
        ),

        filtering
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost',
                onClick: () => {
                  store.setState({ collectionId: null, tag: null });
                  close();
                },
              },
              'Clear filters',
            )
          : null,
      ),
    );
  }

  const unsubscribe = store.subscribe(render);
  render();
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  dialog.focus({ preventScroll: true });
  openSheet = { close };
  return { close };
}
