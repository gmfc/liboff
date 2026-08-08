/**
 * Reading stats and the ranked "best of" list — the payoff for having rated
 * everything.
 */

import { formatNumber, h, mount } from '../ui/dom.js';
import { bombIcon, starIcon } from '../ui/dom.js';
import { bookRow } from '../ui/book-card.js';
import { libraryStats, topBooks } from '../lib/query.js';
import * as store from '../lib/store.js';
import { showBookSheet } from './book-sheet.js';
import { MAX_STARS } from '../lib/model.js';

function statTile(label, value, hint) {
  return h(
    'div',
    { class: 'tile' },
    h('span', { class: 'tile__value' }, value),
    h('span', { class: 'tile__label' }, label),
    hint ? h('span', { class: 'tile__hint' }, hint) : null,
  );
}

function distributionRow(entry, max) {
  const width = max ? Math.round((entry.count / max) * 100) : 0;
  const label =
    entry.key === 'bomb'
      ? h('span', { class: 'dist__label dist__label--bomb' }, bombIcon(16))
      : h(
          'span',
          { class: 'dist__label' },
          String(entry.stars),
          starIcon(true, 13),
        );
  return h(
    'div',
    { class: 'dist' },
    label,
    h(
      'div',
      { class: 'dist__track' },
      h('div', {
        class: ['dist__bar', entry.key === 'bomb' ? 'dist__bar--bomb' : ''],
        style: { width: `${width}%` },
      }),
    ),
    h('span', { class: 'dist__count' }, String(entry.count)),
  );
}

export function renderStats(container) {
  const root = h('div', { class: 'view view--stats' });

  function render() {
    const stats = libraryStats(store.state.books);
    const best = topBooks(store.state.books, 10);

    mount(
      root,
      h('h1', { class: 'view__title' }, 'Stats'),
      h(
        'div',
        { class: 'tiles' },
        statTile('Books', formatNumber(stats.total)),
        statTile('Read', formatNumber(store.state.books.filter((b) => b.shelf === 'read').length)),
        statTile(
          'Average',
          stats.averageStars === null ? '—' : stats.averageStars.toFixed(1),
          stats.averageStars === null ? 'Nothing rated yet' : `out of ${MAX_STARS}`,
        ),
        statTile('Bombs', formatNumber(stats.bombs)),
      ),

      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, 'How you rate'),
        stats.rated
          ? h('div', { class: 'dist-list' }, ...stats.distribution.map((entry) => distributionRow(entry, stats.maxDistribution)))
          : h('p', { class: 'section__hint' }, 'Rate a few books and the shape of your taste shows up here.'),
      ),

      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, 'Your best'),
        best.length
          ? h(
              'div',
              { class: 'rows' },
              ...best.map((book, index) =>
                bookRow(book, { index: index + 1, onOpen: (b) => showBookSheet(b) }),
              ),
            )
          : h('p', { class: 'section__hint' }, 'Star some books to build your ranking.'),
      ),

      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, 'This year'),
        h(
          'div',
          { class: 'tiles' },
          statTile('Finished', formatNumber(stats.finishedThisYear)),
          statTile('Pages read', formatNumber(stats.pagesRead), 'from books with a page count'),
          statTile('Authors', formatNumber(stats.authors)),
        ),
      ),
    );
  }

  mount(container, root);
  render();
  return store.subscribe(render);
}
