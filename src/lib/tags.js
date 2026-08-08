/**
 * Tags: free-form labels, with no existence of their own.
 *
 * A tag is not stored anywhere — it is whatever strings the books happen to
 * carry, counted up on demand. That is the whole difference from a collection:
 * delete the last book with a tag and the tag is simply gone, which is the
 * behaviour you want from an ad-hoc label and emphatically not what you want
 * from a shelf you curated.
 *
 * Matching is case-insensitive so "Sci-Fi" and "sci-fi" are one tag, but the
 * casing you typed first is the one shown back to you.
 */

export function normaliseTag(tag) {
  return String(tag ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function bookHasTag(book, tag) {
  const wanted = normaliseTag(tag);
  if (!wanted) return false;
  return (book.tags ?? []).some((candidate) => normaliseTag(candidate) === wanted);
}

/**
 * Every tag in the library with a count, most used first.
 * @returns {{tag: string, count: number}[]} `tag` in its display casing.
 */
export function tagCounts(books) {
  const counts = new Map();
  for (const book of books) {
    // A book carrying the same tag twice in different cases still counts once.
    const seen = new Set();
    for (const raw of book.tags ?? []) {
      const key = normaliseTag(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { tag: String(raw).trim(), count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }),
  );
}

/**
 * Rename a tag everywhere at once. Returns only the books that changed, so the
 * caller writes the few records that actually moved rather than the library.
 *
 * Renaming onto an existing tag merges the two, which is the point: it is how
 * you clean up "scifi" and "sci-fi" once you notice you have both.
 */
export function renameTagInBooks(books, from, to) {
  const wanted = normaliseTag(from);
  const replacement = String(to ?? '').replace(/\s+/g, ' ').trim();
  if (!wanted || !replacement) return [];

  const changed = [];
  for (const book of books) {
    if (!bookHasTag(book, wanted)) continue;
    const out = [];
    const seen = new Set();
    for (const raw of book.tags ?? []) {
      const value = normaliseTag(raw) === wanted ? replacement : raw;
      const key = normaliseTag(value);
      if (!key || seen.has(key)) continue; // the merge case
      seen.add(key);
      out.push(value);
    }
    changed.push({ ...book, tags: out });
  }
  return changed;
}

/** Remove a tag from every book that carries it. Returns the changed books. */
export function removeTagFromBooks(books, tag) {
  const wanted = normaliseTag(tag);
  if (!wanted) return [];
  return books
    .filter((book) => bookHasTag(book, wanted))
    .map((book) => ({
      ...book,
      tags: (book.tags ?? []).filter((candidate) => normaliseTag(candidate) !== wanted),
    }));
}

/**
 * Tags a book does not have yet, ordered by how much the rest of the library
 * uses them — the suggestion list under the tag input.
 */
export function suggestTags(books, book, { limit = 12, query = '' } = {}) {
  const has = new Set((book?.tags ?? []).map(normaliseTag));
  const needle = normaliseTag(query);
  return tagCounts(books)
    .filter(({ tag }) => !has.has(normaliseTag(tag)))
    .filter(({ tag }) => (needle ? normaliseTag(tag).includes(needle) : true))
    .slice(0, limit)
    .map(({ tag }) => tag);
}
