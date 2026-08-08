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
import { confirmDialog, toast } from '../ui/toast.js';
import { SHELVES, authorText } from '../lib/model.js';
import { formatIsbn } from '../lib/isbn.js';
import { shareText } from '../lib/transfer.js';
import * as store from '../lib/store.js';

let openSheet = null;

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

  const backdrop = h(
    'div',
    {
      class: 'sheet-backdrop',
      onClick: (event) => {
        if (event.target === backdrop) close();
      },
    },
    h(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': book.title },
      h('div', { class: 'sheet__grip', 'aria-hidden': 'true' }),
      content,
    ),
  );

  function onKey(event) {
    if (event.key === 'Escape') close();
  }

  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.classList.add('is-leaving');
    setTimeout(() => backdrop.remove(), 200);
    openSheet = null;
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

    const tags = h('input', {
      class: 'input',
      id: 'field-tags',
      value: (current.tags ?? []).join(', '),
      placeholder: 'sci-fi, borrowed, signed',
    });
    fields.tags = tags;

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
            tags: tags.value,
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
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Tags'), tags),
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
  openSheet = { close };
  return { close };
}
