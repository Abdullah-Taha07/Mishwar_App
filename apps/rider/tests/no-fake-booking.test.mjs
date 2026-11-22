import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('missing real booking handler fails closed instead of simulating a matched driver',()=>{
 const source=readFileSync(new URL('../public/maps.js',import.meta.url),'utf8');
 assert.match(source,/typeof requestLocalRide==='function'\)requestLocalRide\(\);else toast\(/);
 assert.doesNotMatch(source,/requestLocalRide==='function'\)requestLocalRide\(\);else\{state\.fare=getDemoFare\(\);setStage\('matching'\)/);
});
