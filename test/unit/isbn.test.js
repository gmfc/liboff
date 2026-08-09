import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanIsbn,
  formatIsbn,
  isBrazilianIsbn,
  isbn10To13,
  isbn13To10,
  isbnFromBarcode,
  isValidIsbn,
  isValidIsbn10,
  isValidIsbn13,
  toIsbn13,
} from '../../src/lib/isbn.js';

test('cleanIsbn strips separators and upper-cases the check digit', () => {
  assert.equal(cleanIsbn('978-0-14-032872-1'), '9780140328721');
  assert.equal(cleanIsbn(' 0-804-42957-x '), '080442957X');
  assert.equal(cleanIsbn(null), '');
});

test('validates real ISBN-10s', () => {
  assert.ok(isValidIsbn10('0140328726')); // Fantastic Mr Fox
  assert.ok(isValidIsbn10('080442957X')); // check digit X
  assert.ok(isValidIsbn10('0-8044-2957-X'));
  assert.ok(isValidIsbn10('0306406152'));
  assert.ok(!isValidIsbn10('030640615X'), 'X here would be the wrong check digit');
  assert.ok(!isValidIsbn10('0140328727'), 'wrong check digit');
  assert.ok(!isValidIsbn10('014032872'), 'too short');
  assert.ok(!isValidIsbn10('X140328726'), 'X is only legal in the last position');
});

test('validates real ISBN-13s', () => {
  assert.ok(isValidIsbn13('9780140328721'));
  assert.ok(isValidIsbn13('978-0-14-032872-1'));
  assert.ok(isValidIsbn13('9791234567896'), '979 prefix is also a book');
  assert.ok(!isValidIsbn13('9780140328722'), 'wrong check digit');
  assert.ok(!isValidIsbn13('4006381333931'), 'valid EAN-13 but not a book prefix');
});

test('isValidIsbn accepts either width', () => {
  assert.ok(isValidIsbn('0140328726'));
  assert.ok(isValidIsbn('9780140328721'));
  assert.ok(!isValidIsbn('hello'));
});

test('widens ISBN-10 to ISBN-13', () => {
  assert.equal(isbn10To13('0140328726'), '9780140328721');
  assert.equal(isbn10To13('080442957X'), '9780804429573');
  assert.equal(isbn10To13('nonsense'), null);
});

test('narrows ISBN-13 back to ISBN-10, which catalogues still file old books under', () => {
  assert.equal(isbn13To10('9780140328721'), '0140328726');
  assert.equal(isbn13To10('9780804429573'), '080442957X', 'a check digit of ten is X');
  assert.equal(isbn13To10('978-0-441-01359-3'), '0441013597', 'punctuation is no obstacle');
  assert.equal(isbn13To10('nonsense'), null);
});

test('a 979 ISBN has no ISBN-10 form, and is not given a made-up one', () => {
  assert.equal(
    isbn13To10('9791234567896'),
    null,
    '979 was minted after the changeover; there is nothing to narrow to',
  );
});

test('Brazil holds two registration groups, and both are recognised', () => {
  assert.ok(isBrazilianIsbn('9788535914849'), '978-85, the original group');
  assert.ok(isBrazilianIsbn('9786555666779'), '978-65, opened when 85 filled up');
  assert.ok(isBrazilianIsbn('978-65-5532-108-1'), 'punctuation is no obstacle');
  assert.ok(!isBrazilianIsbn('9780140328721'), '978-0 is English-language');
  assert.ok(!isBrazilianIsbn('9783442267743'), '978-3 is German-language');
  assert.ok(!isBrazilianIsbn('0140328726'), 'the group lives in the ISBN-13 form');
  assert.ok(!isBrazilianIsbn('9788535914840'), 'a bad check digit is not an ISBN at all');
});

test('the two widths round-trip', () => {
  for (const ten of ['0140328726', '0441013597', '080442957X', '0061120081']) {
    assert.equal(isbn13To10(isbn10To13(ten)), ten);
  }
});

test('toIsbn13 normalises every accepted form to one key', () => {
  assert.equal(toIsbn13('9780140328721'), '9780140328721');
  assert.equal(toIsbn13('0140328726'), '9780140328721');
  assert.equal(toIsbn13('978-0-14-032872-1'), '9780140328721');
  assert.equal(toIsbn13('12345'), null);
  assert.equal(toIsbn13(''), null);
});

test('isbnFromBarcode strips the price add-on printed beside the barcode', () => {
  // EAN-13 followed by a 5-digit add-on, as printed on most US paperbacks.
  assert.equal(isbnFromBarcode('978014032872151299'), '9780140328721');
  // ...and the 2-digit variant.
  assert.equal(isbnFromBarcode('978014032872112'), '9780140328721');
});

test('isbnFromBarcode accepts an ISBN-10 payload from decoders that report it', () => {
  assert.equal(isbnFromBarcode('0140328726'), '9780140328721');
  assert.equal(isbnFromBarcode('080442957X'), '9780804429573');
});

test('isbnFromBarcode rejects barcodes that are not books', () => {
  assert.equal(isbnFromBarcode('4006381333931'), null, 'a stationery EAN');
  assert.equal(isbnFromBarcode('https://example.com'), null, 'a QR code');
  assert.equal(isbnFromBarcode(''), null);
  assert.equal(isbnFromBarcode('9780140328722'), null, 'check digit must hold');
});

test('formatIsbn groups a 13-digit ISBN the way it is printed under the barcode', () => {
  assert.equal(formatIsbn('9780140328721'), '9 780140 328721');
  assert.equal(formatIsbn('978-0-14-032872-1'), '9 780140 328721');
  // No registration-group tables ship with the app, so shorter forms are left
  // alone rather than hyphenated incorrectly.
  assert.equal(formatIsbn('0140328726'), '0140328726');
  assert.equal(formatIsbn('12345'), '12345');
});
