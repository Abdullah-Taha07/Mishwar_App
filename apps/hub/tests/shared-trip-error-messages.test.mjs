import test from 'node:test';
import assert from 'node:assert/strict';
import {sharedTrip} from '../worker/launch-features.js';
import {readFileSync} from 'node:fs';

const arabicMessage = response => response.json().then(value => {
  assert.equal(response.status,404);
  assert.match(value.error,/\p{Script=Arabic}/u,'Users should receive readable Arabic, not corrupted placeholder question marks');
  assert.doesNotMatch(value.error,/\?{3,}/);
});

test('malformed shared-trip token returns a readable Arabic error without touching the database', async () => {
  const env={DB:{prepare(){throw Error('Shared link validation must happen before any DB access')}}};
  await arabicMessage(await sharedTrip(env,'not-a-share-token'));
});

test('unknown or expired shared-trip token gives a readable Arabic response', async () => {
  const env={DB:{prepare(){return {bind(){return {first:async()=>null}}}}}};
  await arabicMessage(await sharedTrip(env,'a'.repeat(64)));
});

test('shared-trip source has no corrupted fallback error messages', () => {
  const source=readFileSync(new URL('../worker/launch-features.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/error:\s*'\?{3,}[^']*'/);
});
