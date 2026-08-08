/**
 * The tag editor on a book's page.
 *
 * Tagging is a one-tap job, so it lives in the detail view rather than behind
 * the Edit form: a chip per tag with an × on it, a box to type a new one, and
 * the tags you already use offered underneath. The suggestions are the point —
 * they are what stops a library ending up with "sci-fi", "scifi" and
 * "Science Fiction" all meaning the same thing.
 */

import { h } from './dom.js';
import { normaliseTag, suggestTags } from '../lib/tags.js';

/**
 * @param {object} book
 * @param {object[]} allBooks  the library, for suggestions
 * @param {(tags: string[]) => void} onChange
 */
export function tagEditor(book, allBooks, onChange) {
  const tags = book.tags ?? [];

  const input = h('input', {
    class: 'input tag-input',
    placeholder: 'Add a tag',
    'aria-label': 'Add a tag',
    autocomplete: 'off',
    dataset: { testid: 'tag-input' },
    onKeydown: (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(event.target.value);
      }
      // Backspace on an empty box takes the last tag off, the way every
      // token field does.
      if (event.key === 'Backspace' && !event.target.value && tags.length) {
        onChange(tags.slice(0, -1));
      }
    },
    onInput: () => renderSuggestions(),
  });

  function commit(raw) {
    const value = String(raw).replace(/\s+/g, ' ').trim();
    if (!value) return;
    const already = tags.some((tag) => normaliseTag(tag) === normaliseTag(value));
    input.value = '';
    if (already) return; // typing a tag it already has is not an error
    onChange([...tags, value]);
  }

  const suggestions = h('div', { class: 'tag-suggestions' });

  function renderSuggestions() {
    const offered = suggestTags(allBooks, book, { query: input.value, limit: 8 });
    suggestions.replaceChildren(
      ...offered.map((tag) =>
        h(
          'button',
          {
            type: 'button',
            class: 'tag-chip tag-chip--suggestion',
            dataset: { testid: 'tag-suggestion' },
            onClick: () => commit(tag),
          },
          '#',
          tag,
        ),
      ),
    );
  }

  renderSuggestions();

  return h(
    'div',
    { class: 'tag-editor' },
    h(
      'div',
      { class: 'tag-chips' },
      ...tags.map((tag) =>
        h(
          'button',
          {
            type: 'button',
            class: 'tag-chip is-on',
            'aria-label': `Remove tag ${tag}`,
            dataset: { testid: 'book-tag' },
            onClick: () => onChange(tags.filter((entry) => entry !== tag)),
          },
          '#',
          tag,
          h('span', { class: 'tag-chip__x', 'aria-hidden': 'true' }, '×'),
        ),
      ),
    ),
    input,
    suggestions,
  );
}
