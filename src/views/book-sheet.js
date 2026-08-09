/**
 * The book detail sheet: rate it, shelve it, edit its fields, delete it.
 *
 * Edits save as you make them rather than behind a Save button — on a phone
 * the sheet is usually opened to do exactly one thing (move a book to "Read",
 * give it three stars) and a round trip through a form for that is friction.
 */

import { h, icon, formatDate, mount } from '../ui/dom.js';
import { ratingInput, ratingClearButton } from '../ui/rating.js';
import { coverElement } from '../ui/book-card.js';
import { tagEditor } from '../ui/tag-editor.js';
import { toggleChip } from '../ui/chips.js';
import { confirmDialog, toast } from '../ui/toast.js';
import { isInCollection, sortCollections } from '../lib/collections.js';
import { SHELVES, authorText } from '../lib/model.js';
import { formatIsbn } from '../lib/isbn.js';
import { shareText } from '../lib/transfer.js';
import * as store from '../lib/store.js';

let openSheet = null;

/** Ask for a collection name. Resolves to null if the user backs out. */
function promptForName() {
  return new Promise((resolve) => {
    const input = h('input', {
      class: 'input',
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
          'aria-label': 'New collection',
          onSubmit: (event) => {
            event.preventDefault();
            close(input.value.trim() || null);
          },
        },
        h('h2', { class: 'dialog__title' }, 'New collection'),
        input,
        h(
          'div',
          { class: 'dialog__actions' },
          h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => close(null) }, 'Cancel'),
          h(
            'button',
            { type: 'submit', class: 'btn btn--primary', dataset: { testid: 'collection-save' } },
            'Create',
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

export function closeBookSheet() {
  openSheet?.close();
}

/**
 * @param {object} book
 * @param {{onDeleted?: () => void}} options
 */
export function showBookSheet(book, options = {}) {
  closeBookSheet();

  let current = book;
  let editing = false;

  const content = h('div', { class: 'sheet__content' });

  const previouslyFocused = document.activeElement;

  const dialog = h(
    'div',
    {
      class: 'sheet',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': book.title,
      // Focusable so opening the sheet moves the reading position into it;
      // without this a screen reader stays behind on the library grid.
      tabindex: '-1',
    },
    // Sticky, so a long book — one with notes, tags and half a dozen
    // collections — can still be closed without scrolling back to the top.
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
    {
      class: 'sheet-backdrop',
      onClick: (event) => {
        if (event.target === backdrop) close();
      },
    },
    dialog,
  );

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.classList.add('is-leaving');
    setTimeout(() => backdrop.remove(), 200);
    openSheet = null;
    // Hand focus back to whatever opened the sheet, usually the book's card.
    if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
      previouslyFocused.focus({ preventScroll: true });
    }
  }

  async function patch(changes) {
    const next = await store.editBook(current.id, changes);
    if (next) {
      current = next;
      render();
    }
  }

  function render() {
    mount(content, editing ? editView() : detailView());
  }

  /**
   * The cover controls.
   *
   * Plenty of books have no artwork anywhere — the ISBN agencies do not hold
   * it, and a 2026 Brazilian paperback is not going to turn up in an American
   * scanning project. Taking a photo of the book in your hand is the only
   * answer that always works, so it is offered beside the one that sometimes
   * does.
   */
  function coverSection() {
    const held = store.hasLocalCover(current);
    const picker = h('input', {
      type: 'file',
      accept: 'image/*',
      class: 'visually-hidden',
      dataset: { testid: 'cover-file' },
      onChange: async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        await store.setCustomCover(current.id, file);
        render();
        toast('Cover set');
      },
    });

    return h(
      'section',
      { class: 'sheet__section' },
      h('h3', { class: 'sheet__label' }, 'Cover'),
      h(
        'div',
        { class: 'button-row' },
        h(
          'label',
          { class: 'btn btn--ghost btn--small', dataset: { testid: 'cover-pick' } },
          icon('image', { size: 16 }),
          held ? 'Replace' : 'Use a photo',
          picker,
        ),
        held
          ? null
          : h(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost btn--small',
                dataset: { testid: 'cover-find' },
                disabled: !current.isbn,
                onClick: async (event) => {
                  const button = event.currentTarget;
                  button.disabled = true;
                  button.textContent = 'Looking…';
                  const found = await store.findCover(current.id);
                  current = store.findById(current.id) ?? current;
                  render();
                  if (!found) toast('No cover found for this ISBN.', { kind: 'warn' });
                },
              },
              icon('search', { size: 16 }),
              'Find one',
            ),
        held
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost btn--small',
                dataset: { testid: 'cover-remove' },
                onClick: async () => {
                  await store.removeCover(current.id);
                  current = store.findById(current.id) ?? current;
                  render();
                },
              },
              'Remove',
            )
          : null,
      ),
    );
  }

  function detailView() {
    const value = { rating: current.rating, bomb: current.bomb };
    return h(
      'div',
      { class: 'sheet__inner' },
      h(
        'header',
        { class: 'sheet__header' },
        h('div', { class: 'sheet__cover' }, coverElement(current, { eager: true })),
        h(
          'div',
          { class: 'sheet__heading' },
          h('h2', { class: 'sheet__title' }, current.title),
          h('p', { class: 'sheet__author' }, authorText(current)),
          h(
            'p',
            { class: 'sheet__meta' },
            [current.year, current.publisher, current.pages && `${current.pages} pp`]
              .filter(Boolean)
              .join(' · '),
          ),
        ),
      ),

      h(
        'section',
        { class: 'sheet__section' },
        h('h3', { class: 'sheet__label' }, 'Rating'),
        ratingInput(value, (next) => patch(next)),
        ratingClearButton(value, (next) => patch(next)),
      ),

      coverSection(),

      h(
        'section',
        { class: 'sheet__section' },
        h('h3', { class: 'sheet__label' }, 'Shelf'),
        h(
          'div',
          { class: 'segmented' },
          ...SHELVES.map((shelf) =>
            h(
              'button',
              {
                type: 'button',
                class: ['segmented__item', current.shelf === shelf.id ? 'is-on' : ''],
                'aria-pressed': String(current.shelf === shelf.id),
                dataset: { shelf: shelf.id },
                onClick: () => patch({ shelf: shelf.id }),
              },
              shelf.short,
            ),
          ),
        ),
      ),

      h(
        'section',
        { class: 'sheet__section' },
        h('h3', { class: 'sheet__label' }, 'Collections'),
        h(
          'div',
          { class: 'chip-wrap' },
          ...sortCollections(store.state.collections).map((collection) =>
            toggleChip({
              label: collection.name,
              on: isInCollection(collection, current.id),
              testid: 'collection-toggle',
              onToggle: async () => {
                await store.toggleBookInCollection(collection.id, current.id);
                render();
              },
            }),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'toggle-chip toggle-chip--add',
              dataset: { testid: 'add-collection' },
              onClick: async () => {
                const name = await promptForName();
                if (!name) return;
                // Created with this book already in it: you opened the book,
                // so putting it in the collection is the whole intent.
                await store.createCollection(name, [current.id]);
                render();
                toast(`Added to “${name}”`);
              },
            },
            '+ New',
          ),
        ),
      ),

      h(
        'section',
        { class: 'sheet__section' },
        h('h3', { class: 'sheet__label' }, 'Tags'),
        tagEditor(current, store.state.books, (tags) => patch({ tags })),
      ),

      (current.startedAt || current.finishedAt) &&
        h(
          'section',
          { class: 'sheet__section' },
          h(
            'dl',
            { class: 'facts' },
            current.startedAt ? h('div', {}, h('dt', {}, 'Started'), h('dd', {}, formatDate(current.startedAt))) : null,
            current.finishedAt ? h('div', {}, h('dt', {}, 'Finished'), h('dd', {}, formatDate(current.finishedAt))) : null,
          ),
        ),

      current.notes
        ? h(
            'section',
            { class: 'sheet__section' },
            h('h3', { class: 'sheet__label' }, 'Notes'),
            h('p', { class: 'sheet__notes' }, current.notes),
          )
        : null,

      current.isbn
        ? h('p', { class: 'sheet__isbn' }, `ISBN ${formatIsbn(current.isbn)}`)
        : null,

      h(
        'div',
        { class: 'sheet__actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost',
            onClick: () => {
              editing = true;
              render();
            },
          },
          icon('edit', { size: 18 }),
          'Edit',
        ),
        navigator.share
          ? h(
              'button',
              {
                type: 'button',
                class: 'btn btn--ghost',
                onClick: () => navigator.share({ text: shareText(current) }).catch(() => {}),
              },
              'Share',
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--danger-ghost',
            onClick: async () => {
              const confirmed = await confirmDialog({
                title: 'Remove this book?',
                body: `“${current.title}” will be deleted from your library.`,
                confirmLabel: 'Delete',
              });
              if (!confirmed) return;
              const removed = await store.removeBook(current.id);
              close();
              options.onDeleted?.(removed);
              toast('Book removed', {
                action: {
                  label: 'Undo',
                  onClick: () => store.addBook(removed),
                },
              });
            },
          },
          icon('trash', { size: 18 }),
          'Delete',
        ),
      ),
    );
  }

  function editView() {
    const fields = {};
    const field = (name, label, props = {}) => {
      const input = h('input', {
        class: 'input',
        id: `field-${name}`,
        name,
        value: current[name] ?? '',
        ...props,
      });
      fields[name] = input;
      return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), input);
    };

    const notes = h('textarea', { class: 'input input--area', rows: 4, id: 'field-notes' }, current.notes ?? '');
    fields.notes = notes;

    const authors = h('input', {
      class: 'input',
      id: 'field-authors',
      value: (current.authors ?? []).join(', '),
      placeholder: 'Separate names with commas',
    });
    fields.authors = authors;

    return h(
      'form',
      {
        class: 'sheet__inner',
        onSubmit: async (event) => {
          event.preventDefault();
          await patch({
            title: fields.title.value,
            authors: authors.value,
            publisher: fields.publisher.value,
            year: fields.year.value,
            pages: fields.pages.value,
            isbn: fields.isbn.value,
            startedAt: fields.startedAt.value,
            finishedAt: fields.finishedAt.value,
            notes: notes.value,
          });
          editing = false;
          render();
          toast('Saved');
        },
      },
      h('h2', { class: 'sheet__title' }, 'Edit book'),
      field('title', 'Title', { required: true }),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Authors'), authors),
      field('publisher', 'Publisher'),
      h(
        'div',
        { class: 'field-row' },
        field('year', 'Year', { type: 'number', inputmode: 'numeric', min: '1000', max: '2200' }),
        field('pages', 'Pages', { type: 'number', inputmode: 'numeric', min: '1' }),
      ),
      field('isbn', 'ISBN', { inputmode: 'numeric' }),
      h(
        'div',
        { class: 'field-row' },
        field('startedAt', 'Started', { type: 'date' }),
        field('finishedAt', 'Finished', { type: 'date' }),
      ),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Notes'), notes),
      h(
        'div',
        { class: 'sheet__actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost',
            onClick: () => {
              editing = false;
              render();
            },
          },
          'Cancel',
        ),
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'Save'),
      ),
    );
  }

  render();
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  dialog.focus({ preventScroll: true });
  openSheet = { close };
  return { close };
}
