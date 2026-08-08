/**
 * The small shared pieces for tags and collections: the glyphs that tell them
 * apart at a glance, and the pills that show what the library is filtered by.
 *
 * Tags get a leading #, collections a stack mark. The distinction is worth a
 * glyph because the two behave differently — removing the last book from a
 * collection leaves the collection, removing the last book with a tag does
 * not leave the tag.
 */

import { h, svg } from './dom.js';

/** A stack of cards: a collection is a thing you assembled. */
export function collectionIcon(size = 16) {
  return svg(
    'svg',
    {
      class: 'glyph',
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.8,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    svg('path', { d: 'M4 8.5h16M6 5h12M5 12h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z' }),
  );
}

export function tagLabel(tag) {
  return h('span', { class: 'tag-label' }, h('span', { class: 'tag-label__hash' }, '#'), tag);
}

/**
 * One removable pill describing an active filter.
 * @param {{label: Node|string, onRemove: () => void, kind?: string}} options
 */
export function filterPill({ label, onRemove, kind = '' }) {
  return h(
    'button',
    {
      type: 'button',
      class: ['filter-pill', kind ? `filter-pill--${kind}` : ''],
      dataset: { testid: 'filter-pill' },
      'aria-label': `Remove filter`,
      onClick: onRemove,
    },
    label,
    h('span', { class: 'filter-pill__x', 'aria-hidden': 'true' }, '×'),
  );
}

/**
 * A toggleable chip, used wherever something is either on the book or not:
 * the collections a book belongs to, the tags it carries.
 */
export function toggleChip({ label, on, onToggle, testid }) {
  return h(
    'button',
    {
      type: 'button',
      class: ['toggle-chip', on ? 'is-on' : ''],
      'aria-pressed': String(Boolean(on)),
      dataset: testid ? { testid } : {},
      onClick: onToggle,
    },
    label,
  );
}

export function countBadge(count) {
  return h('span', { class: 'count-badge' }, String(count));
}
