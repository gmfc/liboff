import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanIsbn,
  formatIsbn,
  isbn10To13,
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
