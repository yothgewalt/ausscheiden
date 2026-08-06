// ponytail: single runnable check for the pure zoom/pan math. `bun src/components/seatMapZoom.test.ts`
import { strict as assert } from 'node:assert';
import { clampScale, clampTranslate, MAX_SCALE } from './seatMapZoom';

// clampScale: never below fit, never above MAX.
assert.equal(clampScale(0.1, 0.5), 0.5, 'floors at fit');
assert.equal(clampScale(9, 0.5), MAX_SCALE, 'caps at MAX');
assert.equal(clampScale(1, 0.5), 1, 'passes mid-range');
// fit above MAX shouldn't lock you out of MAX.
assert.equal(clampScale(1, 3), MAX_SCALE, 'fit>MAX collapses to MAX');

const vp = { w: 300, h: 500 };
const content = { w: 680, h: 900 };

// Content smaller than viewport on an axis → centered, translate ignored.
const small = clampTranslate(999, 999, 0.3, vp, content); // scaled: 204 x 270, both < vp
assert.equal(small.x, (300 - 680 * 0.3) / 2, 'x centers when narrower');
assert.equal(small.y, (500 - 900 * 0.3) / 2, 'y centers when shorter');

// Content larger than viewport → clamped within [vp - scaled - slack, slack].
const scale = 1; // scaled: 680 x 900, both > vp
const slackX = vp.w * 0.15;
const minX = vp.w - content.w * scale - slackX;
assert.equal(clampTranslate(500, 0, scale, vp, content).x, slackX, 'x clamps to +slack');
assert.equal(clampTranslate(-9999, 0, scale, vp, content).x, minX, 'x clamps to min');
// A value inside range passes through.
assert.equal(clampTranslate(-100, 0, scale, vp, content).x, -100, 'x in-range passes');

console.log('seatMapZoom: all assertions passed');
