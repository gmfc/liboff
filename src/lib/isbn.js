/**
 * ISBN / EAN-13 helpers.
 *
 * Book barcodes are EAN-13 symbols whose payload is an ISBN-13 (prefix 978 or
 * 979). Older stock can carry a 10-digit ISBN, and some barcodes are followed
 * by a 5-digit add-on encoding the price, which we discard.
 */

/** Strip formatting so "978-0-14-032872-1" and "9780140328721" compare equal. */
export function cleanIsbn(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[^0-9X]/g, '');
}

/** Check digit for the first 9 digits of an ISBN-10. Returns '0'-'9' or 'X'. */
function isbn10CheckDigit(digits) {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    sum += (10 - i) * Number(digits[i]);
  }
  const check = (11 - (sum % 11)) % 11;
  return check === 10 ? 'X' : String(check);
}

/** Check digit for the first 12 digits of an ISBN-13 / EAN-13. */
function ean13CheckDigit(digits) {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidIsbn10(input) {
  const value = cleanIsbn(input);
  if (!/^[0-9]{9}[0-9X]$/.test(value)) return false;
  return isbn10CheckDigit(value) === value[9];
}

export function isValidIsbn13(input) {
  const value = cleanIsbn(input);
  if (!/^[0-9]{13}$/.test(value)) return false;
  if (!/^97[89]/.test(value)) return false;
  return ean13CheckDigit(value) === value[12];
}

export function isValidIsbn(input) {
  return isValidIsbn10(input) || isValidIsbn13(input);
}

/** Widen an ISBN-10 to its ISBN-13 form. Returns null if the input is invalid. */
export function isbn10To13(input) {
  const value = cleanIsbn(input);
  if (!isValidIsbn10(value)) return null;
  const body = `978${value.slice(0, 9)}`;
  return body + ean13CheckDigit(body);
}

/**
 * Narrow an ISBN-13 back to its ISBN-10 form, which catalogues still index
 * anything printed before 2007 under.
 *
 * Returns null for a 979 prefix: those were minted after the changeover and
 * have no ISBN-10 at all, so there is nothing to look up.
 */
export function isbn13To10(input) {
  const value = cleanIsbn(input);
  if (!isValidIsbn13(value) || !value.startsWith('978')) return null;
  const body = value.slice(3, 12);
  return body + isbn10CheckDigit(body);
}

/**
 * Normalise any accepted form to a 13-digit ISBN, the single key we store
 * books under. Returns null when the input is not a usable ISBN.
 */
export function toIsbn13(input) {
  const value = cleanIsbn(input);
  if (isValidIsbn13(value)) return value;
  if (isValidIsbn10(value)) return isbn10To13(value);
  return null;
}

/**
 * Group for display.
 *
 * Correct ISBN hyphenation depends on the registration-group ranges, a table
 * far too large to ship in an offline app — and a guessed hyphenation looks
 * authoritative while being wrong. So a 13-digit ISBN is grouped 1-6-6, which
 * is exactly how the number is printed beneath the barcode on the book.
 */
export function formatIsbn(input) {
  const value = cleanIsbn(input);
  if (value.length === 13) {
    return `${value.slice(0, 1)} ${value.slice(1, 7)} ${value.slice(7)}`;
  }
  return value;
}

/**
 * Pull a usable ISBN out of a raw barcode payload.
 *
 * Handles the two things real scanners hand back that a plain validity check
 * would reject: a 5-digit price add-on glued to the end of an EAN-13, and
 * ISBN-10 payloads reported by decoders that understand the ISBN symbology.
 */
export function isbnFromBarcode(raw) {
  const value = cleanIsbn(raw);
  if (!value) return null;

  const direct = toIsbn13(value);
  if (direct) return direct;

  // EAN-13 + 2 or 5 digit add-on (price / issue number).
  if (value.length === 15 || value.length === 18) {
    const candidate = toIsbn13(value.slice(0, 13));
    if (candidate) return candidate;
  }

  // Some decoders return UPC-A style 12 digits for older stock; try widening.
  if (value.length === 12) {
    const candidate = toIsbn13(`0${value}`);
    if (candidate) return candidate;
  }

  return null;
}
