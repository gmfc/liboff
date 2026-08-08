/** The book tile used throughout the library grid and search results. */

import { h, icon } from './dom.js';
import { authorText } from '../lib/model.js';
import { localCover } from '../lib/store.js';
import { ratingDisplay } from './rating.js';

/**
 * A cover, or a generated stand-in. Books without artwork are common (older
 * ISBNs, manual entries), and a blank rectangle makes a shelf unreadable — so
 * the placeholder carries the title and a colour derived from it.
 */
export function coverElement(book, { eager = false } = {}) {
  const cached = localCover(book);
  const source = cached || book.coverUrl;
  // No author line here: the card beneath already carries it, and repeating it
  // on the artwork reads as a rendering fault rather than a design.
  const placeholder = h(
    'div',
    { class: 'cover cover--placeholder', style: { '--hue': String(hueFor(book)) } },
    h('span', { class: 'cover__title' }, book.title),
  );
  if (!source) return placeholder;

  const wrapper = h('div', { class: 'cover' }, placeholder.cloneNode(true));
  const image = h('img', {
    class: 'cover__img',
    src: source,
    alt: '',
    loading: eager ? 'eager' : 'lazy',
    decoding: 'async',
    // Keep the placeholder if the cover 404s or the device is offline.
    onError: () => image.remove(),
    onLoad: () => wrapper.classList.add('has-image'),
  });
  wrapper.appendChild(image);
  return wrapper;
}

/** Stable pastel per title, so a shelf of placeholders still looks varied. */
function hueFor(book) {
  const key = `${book.title}${book.authors?.[0] ?? ''}`;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) % 360;
  return hash;
}

const SHELF_BADGE = {
  reading: { label: 'Reading', className: 'badge--reading' },
  read: { label: 'Read', className: 'badge--read' },
  abandoned: { label: 'Abandoned', className: 'badge--abandoned' },
  wishlist: { label: 'Wishlist', className: 'badge--wishlist' },
};

export function bookCard(book, { onOpen, eager = false } = {}) {
  const badge = SHELF_BADGE[book.shelf];
  return h(
    'button',
    {
      type: 'button',
      class: 'card',
      dataset: { id: book.id, testid: 'book-card' },
      onClick: () => onOpen?.(book),
    },
    h(
      'div',
      { class: 'card__cover' },
      coverElement(book, { eager }),
      badge ? h('span', { class: `badge ${badge.className}` }, badge.label) : null,
      book.bomb ? h('span', { class: 'badge badge--bomb' }, 'Bomb') : null,
    ),
    h(
      'div',
      { class: 'card__body' },
      h('span', { class: 'card__title' }, book.title),
      h('span', { class: 'card__author' }, authorText(book)),
      ratingDisplay(book),
    ),
  );
}

/** A denser row, used for search results and the "top rated" list. */
export function bookRow(book, { onOpen, trailing, index } = {}) {
  return h(
    'button',
    {
      type: 'button',
      class: 'row-card',
      dataset: { id: book.id ?? '' },
      onClick: () => onOpen?.(book),
    },
    index !== undefined ? h('span', { class: 'row-card__rank' }, String(index)) : null,
    h('div', { class: 'row-card__cover' }, coverElement(book)),
    h(
      'div',
      { class: 'row-card__body' },
      h('span', { class: 'row-card__title' }, book.title),
      h('span', { class: 'row-card__meta' }, [authorText(book), book.year].filter(Boolean).join(' · ')),
      ratingDisplay(book, { size: 13 }),
    ),
    trailing ?? icon('back', { size: 18, className: 'row-card__chevron' }),
  );
}
