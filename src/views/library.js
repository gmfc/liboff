/**
 * The library: everything you have catalogued, filtered by shelf, searched by
 * text, sorted however you like.
 *
 * Only the grid is re-rendered when state changes — the controls above it are
 * built once and kept, so typing in the search box never loses focus or the
 * caret position.
 */

import { debounce, h, icon, mount } from '../ui/dom.js';
import { bookCard } from '../ui/book-card.js';
import { collectionIcon, filterPill, tagLabel } from '../ui/chips.js';
import { findCollection, orderLabel } from '../lib/collections.js';
import { SHELVES } from '../lib/model.js';
import { countsByShelf, selectBooks } from '../lib/query.js';
import * as store from '../lib/store.js';
import { showBookSheet } from './book-sheet.js';
import { showFilterSheet } from './filter-sheet.js';
import { navigate } from '../router.js';

export function renderLibrary(container) {
  const searchInput = h('input', {
    class: 'search__input',
    type: 'search',
    inputmode: 'search',
    placeholder: 'Search title, author, tag…',
    'aria-label': 'Search your library',
    value: store.state.search,
    dataset: { testid: 'library-search' },
    onInput: debounce((event) => store.setState({ search: event.target.value }), 180),
  });

  /** The collection on screen, if any — it owns the sort while it is open. */
  function activeCollection() {
    return findCollection(store.state.collections, store.state.collectionId);
  }

  const chipBar = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Shelves' });
  const grid = h('div', { class: 'grid', dataset: { testid: 'library-grid' } });
  const summary = h('p', { class: 'summary', 'aria-live': 'polite' });
  const pills = h('div', { class: 'filter-pills' });

  const filterButton = h(
    'button',
    {
      type: 'button',
      class: 'filter-btn',
      'aria-label': 'Collections and tags',
      dataset: { testid: 'open-filters' },
      onClick: () => showFilterSheet(),
    },
    icon('filter', { size: 18 }),
  );

  /** Pills for the facets in play, each removable where it sits. */
  function renderPills() {
    const active = [];
    const collection = findCollection(store.state.collections, store.state.collectionId);
    if (collection) {
      active.push(
        filterPill({
          kind: 'collection',
          label: h('span', { class: 'filter-pill__label' }, collectionIcon(14), collection.name),
          onRemove: () => store.setState({ collectionId: null }),
        }),
      );
    }
    if (store.state.tag) {
      active.push(
        filterPill({
          kind: 'tag',
          label: tagLabel(store.state.tag),
          onRemove: () => store.setState({ tag: null }),
        }),
      );
    }
    mount(pills, ...active);
    pills.hidden = active.length === 0;
    filterButton.classList.toggle('is-on', active.length > 0);
  }

  function renderChips() {
    const counts = countsByShelf(store.state.books);
    const entries = [{ id: 'all', label: 'All' }, ...SHELVES.map((s) => ({ id: s.id, label: s.short }))];
    mount(
      chipBar,
      ...entries.map((entry) =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: ['chip', store.state.shelf === entry.id ? 'is-on' : ''],
            'aria-selected': String(store.state.shelf === entry.id),
            dataset: { shelf: entry.id },
            onClick: () => store.setPreference('shelf', entry.id),
          },
          entry.label,
          h('span', { class: 'chip__count' }, String(counts[entry.id] ?? 0)),
        ),
      ),
    );
  }

  function emptyState() {
    if (!store.state.books.length) {
      return h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty__art' }, icon('scan', { size: 42 })),
        h('h2', { class: 'empty__title' }, 'Your shelves are empty'),
        h('p', { class: 'empty__body' }, 'Scan the barcode on the back of a book to add it in a couple of seconds.'),
        h(
          'button',
          { type: 'button', class: 'btn btn--primary', onClick: () => navigate('/scan') },
          icon('scan', { size: 18 }),
          'Scan a book',
        ),
      );
    }
    if (store.state.search) {
      return h(
        'div',
        { class: 'empty' },
        h('h2', { class: 'empty__title' }, 'No matches'),
        h('p', { class: 'empty__body' }, `Nothing in your library matches “${store.state.search}”.`),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost',
            onClick: () => {
              searchInput.value = '';
              store.setState({ search: '' });
            },
          },
          'Clear search',
        ),
      );
    }
    if (store.state.collectionId || store.state.tag) {
      return h(
        'div',
        { class: 'empty' },
        h('h2', { class: 'empty__title' }, 'Nothing here yet'),
        h(
          'p',
          { class: 'empty__body' },
          'No book matches this combination. Collections are filled from a book’s own page.',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost',
            onClick: () => store.setState({ collectionId: null, tag: null, shelf: 'all' }),
          },
          'Clear filters',
        ),
      );
    }
    return h(
      'div',
      { class: 'empty' },
      h('h2', { class: 'empty__title' }, 'Nothing on this shelf yet'),
      h('p', { class: 'empty__body' }, 'Move a book here from its detail page.'),
    );
  }

  function renderGrid() {
    const collection = activeCollection();
    const books = selectBooks(store.state.books, {
      shelf: store.state.shelf,
      search: store.state.search,
      // A collection carries its own order; the library preference applies
      // everywhere else.
      sort: collection ? collection.order : store.state.sort,
      tag: store.state.tag,
      // Filters by membership, and — passed as the ordered list it is — can
      // also supply the order the books were added in.
      ids: collection ? collection.bookIds : null,
    });

    // The order used to be a control you could see. Now that it lives in the
    // sheet, the summary line is where it stays visible — otherwise a library
    // sorted by rating looks like a library in no order at all.
    const order = orderLabel(collection ? collection.order : store.state.sort);
    summary.textContent = books.length
      ? `${books.length} book${books.length === 1 ? '' : 's'} · ${order}`
      : '';

    if (!books.length) {
      mount(grid, emptyState());
      grid.classList.add('grid--empty');
      return;
    }
    grid.classList.remove('grid--empty');
    // Cheap enough to rebuild: a few hundred tiles land well inside one frame,
    // and it keeps the DOM an exact function of the filtered list.
    const fragment = document.createDocumentFragment();
    books.forEach((book, index) => {
      fragment.appendChild(
        bookCard(book, { onOpen: (b) => showBookSheet(b), eager: index < 6 }),
      );
    });
    mount(grid, fragment);
  }

  function renderAll() {
    if (document.activeElement !== searchInput && searchInput.value !== store.state.search) {
      searchInput.value = store.state.search;
    }
    renderChips();
    renderPills();
    renderGrid();
  }

  mount(
    container,
    h(
      'div',
      { class: 'view view--library' },
      h(
        'div',
        { class: 'library__controls' },
        // The filter button sits by the search box rather than in the chip
        // row: three controls in that row left the shelf names clipped.
        h(
          'div',
          { class: 'search-row' },
          h(
            'div',
            { class: 'search' },
            icon('search', { size: 18, className: 'search__icon' }),
            searchInput,
          ),
          filterButton,
        ),
        chipBar,
        pills,
      ),
      summary,
      grid,
    ),
  );

  renderAll();
  return store.subscribe(renderAll);
}
