/**
 * The rating control: 0–5 stars, plus a bomb for books that are not merely
 * weak. Stars and bomb are mutually exclusive — picking one clears the other.
 *
 * Zero stars is a real rating and distinct from "not rated yet", so it gets
 * its own narrow target to the left of the stars rather than hiding behind a
 * double-tap on the first star.
 */

import { bombIcon, h, starIcon } from './dom.js';
import { MAX_STARS, ratingText } from '../lib/model.js';

/**
 * Read-only rating, used on cards.
 * @param {object} book
 */
export function ratingDisplay(book, { size = 15 } = {}) {
  if (book.bomb) {
    return h('span', { class: 'rating rating--bomb', title: 'Bombed' }, bombIcon(size + 2), 'Bomb');
  }
  if (typeof book.rating !== 'number') {
    return h('span', { class: 'rating rating--none' }, 'Unrated');
  }
  const stars = [];
  for (let i = 1; i <= MAX_STARS; i += 1) stars.push(starIcon(i <= book.rating, size));
  return h(
    'span',
    { class: 'rating', 'aria-label': `${book.rating} out of ${MAX_STARS} stars`, title: ratingText(book) },
    ...stars,
  );
}

/**
 * Editable rating.
 * @param {{rating: number|null, bomb: boolean}} value
 * @param {(next: {rating: number|null, bomb: boolean}) => void} onChange
 */
export function ratingInput(value, onChange, { size = 30 } = {}) {
  const current = value.bomb ? null : value.rating;

  const starButtons = [];
  for (let i = 1; i <= MAX_STARS; i += 1) {
    starButtons.push(
      h(
        'button',
        {
          type: 'button',
          class: ['star-btn', !value.bomb && current !== null && i <= current ? 'is-on' : ''],
          'aria-label': `${i} star${i === 1 ? '' : 's'}`,
          'aria-pressed': String(!value.bomb && current === i),
          onClick: () => onChange({ rating: i, bomb: false }),
        },
        starIcon(!value.bomb && current !== null && i <= current, size),
      ),
    );
  }

  return h(
    'div',
    { class: 'rating-input', role: 'group', 'aria-label': 'Rating' },
    h(
      'button',
      {
        type: 'button',
        class: ['zero-btn', !value.bomb && current === 0 ? 'is-on' : ''],
        'aria-label': 'Zero stars',
        'aria-pressed': String(!value.bomb && current === 0),
        onClick: () => onChange({ rating: 0, bomb: false }),
      },
      '0',
    ),
    h('div', { class: 'star-row' }, ...starButtons),
    h(
      'button',
      {
        type: 'button',
        class: ['bomb-btn', value.bomb ? 'is-on' : ''],
        'aria-label': 'Bomb — really bad',
        'aria-pressed': String(Boolean(value.bomb)),
        title: 'Bomb — really bad',
        onClick: () => onChange({ rating: null, bomb: !value.bomb }),
      },
      bombIcon(size - 4),
    ),
  );
}

/** The "clear rating" affordance, shown only when there is one to clear. */
export function ratingClearButton(value, onChange) {
  if (!value.bomb && value.rating === null) return null;
  return h(
    'button',
    {
      type: 'button',
      class: 'link-btn',
      onClick: () => onChange({ rating: null, bomb: false }),
    },
    'Clear rating',
  );
}
