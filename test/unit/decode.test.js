import test from 'node:test';
import assert from 'node:assert/strict';

import { createConfirmer } from '../../src/scanner/decode.js';

test('a code is only accepted once it has been read twice', () => {
  const confirmer = createConfirmer({ needed: 2 });
  assert.equal(confirmer.offer('9780140328721', 1000), null);
  assert.equal(confirmer.offer('9780140328721', 1100), '9780140328721');
});

test('the count resets after a confirmation so the next book starts clean', () => {
  const confirmer = createConfirmer({ needed: 2 });
  confirmer.offer('A', 1000);
  assert.equal(confirmer.offer('A', 1050), 'A');
  assert.equal(confirmer.offer('A', 1100), null, 'a fresh pair is needed again');
});

test('sightings expire, so two different books never combine into a false read', () => {
  const confirmer = createConfirmer({ needed: 2, windowMs: 1500 });
  assert.equal(confirmer.offer('A', 0), null);
  assert.equal(confirmer.offer('A', 5000), null, 'the first sighting has aged out');
  assert.equal(confirmer.offer('A', 5100), 'A');
});

test('interleaved codes are counted separately', () => {
  const confirmer = createConfirmer({ needed: 2 });
  assert.equal(confirmer.offer('A', 0), null);
  assert.equal(confirmer.offer('B', 10), null);
  assert.equal(confirmer.offer('B', 20), 'B');
});

test('reset clears everything in flight', () => {
  const confirmer = createConfirmer({ needed: 2 });
  confirmer.offer('A', 0);
  confirmer.reset();
  assert.equal(confirmer.offer('A', 10), null);
});
