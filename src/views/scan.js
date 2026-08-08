/**
 * Adding books: by barcode, by photo, by title search, or by hand.
 *
 * The camera is only ever started by a tap. Browsers require a user gesture
 * for it, and it also means opening this tab does not light up the camera of
 * someone who just wanted to type an ISBN.
 *
 * After a book is added the scanner resumes on its own — cataloguing a shelf
 * means scanning twenty books in a row, and a tap between each one is the
 * difference between pleasant and tedious.
 */

import { debounce, h, icon, mount } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { bookRow } from '../ui/book-card.js';
import { ratingInput } from '../ui/rating.js';
import { SHELVES, DEFAULT_SHELF, makeBook } from '../lib/model.js';
import { formatIsbn, isbnFromBarcode, toIsbn13 } from '../lib/isbn.js';
import { FOUND, UNAVAILABLE, lookupIsbn, searchByText } from '../lib/metadata.js';
import * as store from '../lib/store.js';
import { cameraSupported, decodeImageFile, describeCameraError, startScanner } from '../scanner/camera.js';
import { showBookSheet } from './book-sheet.js';

export function renderScan(container) {
  /** @type {'idle'|'starting'|'scanning'|'looking-up'|'result'|'manual'} */
  let mode = 'idle';
  let session = null;
  let statusText = '';
  let candidate = null; // metadata awaiting confirmation
  let duplicate = null; // book already in the library
  // Why the candidate is blank, when it is: a catalogue that has never heard
  // of the book and a catalogue that could not be reached are different
  // problems, and only one of them is worth offering a retry for.
  let lookupStatus = FOUND;
  // Whether a catalogue stayed silent while that verdict was reached. A miss
  // with one service down is still a miss, but it is worth asking again.
  let lookupPartial = false;
  // Held here rather than read off the inputs: choosing a shelf or a rating
  // re-renders the panel, and anything living only in the DOM would be lost.
  let draft = { shelf: DEFAULT_SHELF, rating: null, bomb: false, title: '', author: '' };
  let torchOn = false;

  const video = h('video', {
    class: 'scanner__video',
    playsinline: true,
    muted: true,
    autoplay: true,
    'aria-label': 'Camera preview',
  });

  const panel = h('div', { class: 'scan__panel' });
  const results = h('div', { class: 'scan__results' });

  function setMode(next, extra = {}) {
    mode = next;
    if ('status' in extra) statusText = extra.status;
    renderPanel();
  }

  /* ---------------------------------------------------------------- camera */

  async function start() {
    if (!cameraSupported()) {
      toast('This browser cannot open the camera. Enter the ISBN instead.', { kind: 'warn' });
      setMode('manual');
      return;
    }
    setMode('starting', { status: 'Starting camera…' });
    try {
      session = await startScanner(video, {
        onResult: handleBarcode,
        onError: () => {},
        onReady: () => {
          setMode('scanning', { status: 'Hold the barcode inside the frame' });
        },
      });
    } catch (error) {
      session = null;
      setMode('idle', { status: '' });
      toast(describeCameraError(error), { kind: 'warn', duration: 5000 });
    }
  }

  function stop() {
    session?.stop();
    session = null;
    torchOn = false;
  }

  async function handleBarcode(raw) {
    const isbn = isbnFromBarcode(raw);
    if (!isbn) {
      statusText = 'That barcode is not a book (no ISBN).';
      renderPanel();
      return;
    }
    session?.pause();
    navigator.vibrate?.(40);
    await presentIsbn(isbn);
  }

  /* ------------------------------------------------------------- lookup UI */

  const blankCandidate = (isbn) => ({
    isbn,
    title: '',
    authors: [],
    publisher: '',
    year: null,
    pages: null,
    coverUrl: '',
    source: null,
  });

  async function presentIsbn(isbn, { refresh = false } = {}) {
    const existing = store.findByIsbn(isbn);
    if (existing) {
      duplicate = existing;
      candidate = null;
      setMode('result');
      return;
    }
    duplicate = null;
    candidate = null;
    setMode('looking-up', { status: `Looking up ${formatIsbn(isbn)}…` });

    const { status, book, sources, partial } = await lookupIsbn(isbn, { refresh });
    lookupStatus = status;
    lookupPartial = partial;
    candidate =
      status === FOUND
        ? { ...book, isbn, source: sources.join(' + ') }
        : blankCandidate(isbn);
    // Typed-in details survive a retry: it would be rude to make someone key
    // the title twice because the second attempt also failed.
    if (!refresh) draft = { shelf: DEFAULT_SHELF, rating: null, bomb: false, title: '', author: '' };
    setMode('result');
  }

  function resumeScanning() {
    candidate = null;
    duplicate = null;
    if (session) {
      session.resume();
      setMode('scanning', { status: 'Point at the barcode' });
    } else {
      setMode('idle', { status: '' });
    }
  }

  async function commit(input) {
    const book = await store.addBook(input);
    toast(`Added “${book.title}”`, {
      action: { label: 'Open', onClick: () => showBookSheet(book) },
    });
    resumeScanning();
  }

  /* --------------------------------------------------------------- panels */

  function scannerFrame() {
    const active = mode === 'starting' || mode === 'scanning' || mode === 'looking-up';
    return h(
      'div',
      { class: ['scanner', active ? 'is-active' : ''] },
      video,
      h(
        'div',
        { class: 'scanner__overlay', 'aria-hidden': 'true' },
        h('div', { class: 'scanner__reticle' }, h('span', { class: 'scanner__laser' })),
      ),
      statusText ? h('p', { class: 'scanner__status' }, statusText) : null,
      h(
        'div',
        { class: 'scanner__controls' },
        session?.hasTorch
          ? h(
              'button',
              {
                type: 'button',
                class: ['icon-btn', torchOn ? 'is-on' : ''],
                'aria-label': 'Toggle torch',
                onClick: async () => {
                  torchOn = !torchOn;
                  await session.setTorch(torchOn);
                  renderPanel();
                },
              },
              icon('torch', { size: 20 }),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            class: 'icon-btn',
            'aria-label': 'Stop camera',
            onClick: () => {
              stop();
              setMode('idle', { status: '' });
            },
          },
          icon('close', { size: 20 }),
        ),
      ),
    );
  }

  function idlePanel() {
    return h(
      'div',
      { class: 'scan__intro' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary btn--big',
          dataset: { testid: 'start-scan' },
          onClick: start,
        },
        icon('camera', { size: 20 }),
        'Scan a barcode',
      ),
      h(
        'div',
        { class: 'scan__alt' },
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost', onClick: () => setMode('manual') },
          'Enter ISBN',
        ),
        h(
          'label',
          { class: 'btn btn--ghost' },
          icon('image', { size: 18 }),
          'From photo',
          h('input', {
            type: 'file',
            accept: 'image/*',
            class: 'visually-hidden',
            onChange: async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setMode('looking-up', { status: 'Reading the photo…' });
              try {
                const values = await decodeImageFile(file);
                const isbn = values.map(isbnFromBarcode).find(Boolean);
                if (!isbn) {
                  setMode('idle', { status: '' });
                  toast('No book barcode found in that photo.', { kind: 'warn' });
                  return;
                }
                await presentIsbn(isbn);
              } catch {
                setMode('idle', { status: '' });
                toast('That image could not be read.', { kind: 'warn' });
              }
            },
          }),
        ),
      ),
    );
  }

  function duplicatePanel() {
    return h(
      'div',
      { class: 'result-card' },
      h('p', { class: 'result-card__flag' }, icon('check', { size: 16 }), 'Already in your library'),
      bookRow(duplicate, { onOpen: (book) => showBookSheet(book) }),
      h(
        'div',
        { class: 'result-card__actions' },
        h('button', { type: 'button', class: 'btn btn--primary', onClick: resumeScanning }, 'Scan another'),
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost', onClick: () => showBookSheet(duplicate) },
          'Open',
        ),
      ),
    );
  }

  function candidatePanel() {
    const found = Boolean(candidate.title);
    const preview = makeBook({
      ...candidate,
      shelf: draft.shelf,
      rating: draft.rating,
      bomb: draft.bomb,
      title: candidate.title || 'Unknown title',
    });

    const titleInput = found
      ? null
      : h('input', {
          class: 'input',
          placeholder: 'Title',
          'aria-label': 'Title',
          value: draft.title,
          dataset: { testid: 'candidate-title' },
          onInput: (event) => {
            draft.title = event.target.value;
          },
        });
    const authorInput = found
      ? null
      : h('input', {
          class: 'input',
          placeholder: 'Author',
          'aria-label': 'Author',
          value: draft.author,
          onInput: (event) => {
            draft.author = event.target.value;
          },
        });

    return h(
      'div',
      { class: 'result-card', dataset: { testid: 'scan-result' } },
      found
        ? h('p', { class: 'result-card__flag' }, icon('check', { size: 16 }), `Found via ${candidate.source}`)
        : h(
            'p',
            { class: 'result-card__flag result-card__flag--warn', dataset: { status: lookupStatus } },
            lookupStatus === UNAVAILABLE
              ? store.state.online
                ? 'The catalogues could not be reached just now. Try again, or add the details yourself.'
                : 'Offline, so we could not look this up. Add the details now or edit later.'
              : lookupPartial
                ? 'Not in the catalogues that answered — one of them was unavailable. Add the details yourself, or try again.'
                : 'No catalogue entry for this ISBN — add the details yourself.',
          ),
      found ? bookRow(preview, { trailing: h('span') }) : null,
      !found
        ? h(
            'div',
            { class: 'form-stack' },
            h('p', { class: 'result-card__isbn' }, `ISBN ${formatIsbn(candidate.isbn)}`),
            // A failed lookup used to be final: the only way back was to scan
            // the book again. It is one request, so offer it.
            (lookupStatus === UNAVAILABLE || lookupPartial) && candidate.isbn
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost',
                    dataset: { testid: 'retry-lookup' },
                    onClick: () => presentIsbn(candidate.isbn, { refresh: true }),
                  },
                  icon('refresh', { size: 18 }),
                  'Try the lookup again',
                )
              : null,
            titleInput,
            authorInput,
          )
        : null,

      h('h3', { class: 'sheet__label' }, 'Shelf'),
      h(
        'div',
        { class: 'segmented' },
        ...SHELVES.map((shelf) =>
          h(
            'button',
            {
              type: 'button',
              class: ['segmented__item', draft.shelf === shelf.id ? 'is-on' : ''],
              'aria-pressed': String(draft.shelf === shelf.id),
              dataset: { shelf: shelf.id },
              onClick: () => {
                draft.shelf = shelf.id;
                renderPanel();
              },
            },
            shelf.short,
          ),
        ),
      ),

      h('h3', { class: 'sheet__label' }, 'Rating (optional)'),
      ratingInput(draft, (next) => {
        draft = { ...draft, ...next };
        renderPanel();
      }, { size: 26 }),

      h(
        'div',
        { class: 'result-card__actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--primary',
            dataset: { testid: 'confirm-add' },
            onClick: () =>
              commit({
                ...candidate,
                title: found
                  ? candidate.title
                  : draft.title.trim() || (candidate.isbn ? `ISBN ${candidate.isbn}` : 'Untitled'),
                authors: found ? candidate.authors : draft.author,
                shelf: draft.shelf,
                rating: draft.rating,
                bomb: draft.bomb,
              }),
          },
          icon('plus', { size: 18 }),
          'Add to library',
        ),
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: resumeScanning }, 'Skip'),
      ),
    );
  }

  function manualPanel() {
    const isbnInput = h('input', {
      class: 'input',
      inputmode: 'numeric',
      autocomplete: 'off',
      placeholder: '978…',
      'aria-label': 'ISBN',
      dataset: { testid: 'manual-isbn' },
    });
    const error = h('p', { class: 'field__error' });

    return h(
      'form',
      {
        class: 'form-stack',
        onSubmit: async (event) => {
          event.preventDefault();
          const isbn = toIsbn13(isbnInput.value);
          if (!isbn) {
            error.textContent = 'That is not a valid ISBN — check the digits and try again.';
            return;
          }
          error.textContent = '';
          await presentIsbn(isbn);
        },
      },
      h('h2', { class: 'section__title' }, 'Enter an ISBN'),
      h('p', { class: 'section__hint' }, 'The 10 or 13 digit number printed under the barcode.'),
      isbnInput,
      error,
      h(
        'div',
        { class: 'result-card__actions' },
        h('button', { type: 'submit', class: 'btn btn--primary' }, 'Look up'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost',
            onClick: () => {
              candidate = { isbn: null, title: '', authors: [], publisher: '', year: null, pages: null, coverUrl: '', source: null };
              draft = { shelf: DEFAULT_SHELF, rating: null, bomb: false, title: '', author: '' };
              setMode('result');
            },
          },
          'Add without ISBN',
        ),
        h('button', { type: 'button', class: 'btn btn--ghost', onClick: () => setMode('idle', { status: '' }) }, 'Back'),
      ),
    );
  }

  function renderPanel() {
    const parts = [];
    if (mode === 'starting' || mode === 'scanning' || (mode === 'looking-up' && session)) {
      parts.push(scannerFrame());
    }
    if (mode === 'idle') parts.push(idlePanel());
    if (mode === 'manual') parts.push(manualPanel());
    if (mode === 'looking-up' && !session) {
      parts.push(h('p', { class: 'section__hint' }, statusText || 'Looking up…'));
    }
    if (mode === 'looking-up') parts.push(h('div', { class: 'spinner', 'aria-label': 'Loading' }));
    if (mode === 'result') {
      parts.push(duplicate ? duplicatePanel() : candidatePanel());
    }
    mount(panel, ...parts);
  }

  /* -------------------------------------------------------- title search */

  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Title, author or ISBN',
    'aria-label': 'Search the online catalogue',
    onInput: debounce(async (event) => {
      const query = event.target.value.trim();
      if (query.length < 3) {
        mount(results);
        return;
      }
      mount(results, h('div', { class: 'spinner' }));
      const found = await searchByText(query);
      if (!found.length) {
        mount(
          results,
          h('p', { class: 'section__hint' }, store.state.online ? 'Nothing found.' : 'You are offline.'),
        );
        return;
      }
      mount(
        results,
        ...found.map((item) =>
          bookRow(makeBook({ ...item, title: item.title || 'Untitled' }), {
            trailing: icon('plus', { size: 18 }),
            onOpen: () =>
              commit({ ...item, shelf: DEFAULT_SHELF }),
          }),
        ),
      );
    }, 400),
  });

  mount(
    container,
    h(
      'div',
      { class: 'view view--scan' },
      panel,
      h(
        'section',
        { class: 'section' },
        h('h2', { class: 'section__title' }, 'No barcode?'),
        h(
          'p',
          { class: 'section__hint' },
          'Search the Open Library catalogue by title or author. An ISBN pasted here is looked up directly.',
        ),
        searchInput,
        results,
      ),
    ),
  );

  renderPanel();

  return () => {
    stop();
  };
}
