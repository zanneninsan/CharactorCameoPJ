import assert from 'node:assert/strict';
import { chooseAnomaly, galleryDebugOptions } from '../content/characters/zannenin/assets/site/manzokukyo-gallery-loop.js';

const allKinds = galleryDebugOptions.filter(option => option.kind !== 'normal').map(option => option.kind);
const unseen = 'watching-crowd', encounteredKinds = allKinds.filter(kind => kind !== unseen);
// Midpoints cover the weighted distribution exactly, without a flaky RNG test.
function distribution(options, samples) {
  const counts = new Map();
  for (let i = 0; i < samples; i++) {
    const draws = [.8, (i + .5) / samples, .5];
    const anomaly = chooseAnomaly(() => draws.shift(), options);
    assert(anomaly); if ('index' in anomaly) assert.equal(anomaly.index, 12);
    counts.set(anomaly.kind, (counts.get(anomaly.kind) || 0) + 1);
  }
  return counts;
}
const weighted = distribution({ visitorsReady: true, encounteredKinds }, 19500);
assert.equal(weighted.get(unseen), 1500);
for (const kind of encounteredKinds) assert.equal(weighted.get(kind), 1000, 'all discovered kinds remain equally available');
for (const known of [[], allKinds]) {
  const uniform = distribution({ visitorsReady: true, encounteredKinds: known }, 19000);
  assert.equal(uniform.size, 19); assert([...uniform.values()].every(count => count === 1000), 'fresh and completed collections are uniform');
}
const withoutVisitors = distribution({ visitorsReady: false, encounteredKinds }, 13000);
assert.equal(withoutVisitors.size, 13);
for (const option of galleryDebugOptions.filter(option => option.visitors)) assert(!withoutVisitors.has(option.kind), 'unloaded models cannot enter the weighted pool');
assert([...withoutVisitors.values()].every(count => count === 1000), 'an unavailable missing entry cannot steal probability');
for (const known of [[], encounteredKinds, allKinds]) {
  let anomalies = 0;
  for (let i = 0; i < 10000; i++) {
    let draw = 0;
    if (chooseAnomaly(() => draw++ === 0 ? (i + .5) / 10000 : .5, { visitorsReady: true, encounteredKinds: known })) anomalies++;
  }
  assert.equal(anomalies, 6600, 'discovery progress never changes the 66% anomaly occurrence rate');
}
assert.deepEqual(distribution({ visitorsReady: true, encounteredKinds: [...encounteredKinds, ...encounteredKinds, 'unknown'] }, 19500), weighted, 'duplicate and stale saved names do not affect weights');
console.log('Anomaly weights passed: unseen 1.5:1, uniform fresh/completed collections, unavailable actors excluded, and 66% occurrence at every progress level.');
