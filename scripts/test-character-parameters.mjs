import test from "node:test";
import assert from "node:assert/strict";
import { normalizeParameters, calibratedSegment, chooseWalkDirection, PARAMETER_FIELDS, mergeParameters, speechMetrics, modelLayout, bubbleTop } from "../electron/character-parameters.mjs";
import { createHistory } from '../src/parameter-history.mjs';

test("legacy profiles receive safe defaults", () => {
  assert.deepEqual(normalizeParameters(), {schemaVersion: 2, audioStartOffsetMs: 0, audioEndOffsetMs: 0, modelScalePercent: 60,
    fontSizePx: 13, bubbleOffsetY: 0, bubbleTransparency: 24});
  assert.deepEqual(normalizeParameters(null), normalizeParameters());
});
test("registry normalizes invalid fields, bounds and unknown future settings", () => {
  const result = normalizeParameters({audioOffsetMs: Infinity, bubbleOffsetY: 999, walkDirection: "invalid", extensions: {future: true}});
  assert.equal(result.audioStartOffsetMs, 0); assert.equal(result.bubbleOffsetY, 250);
  assert.equal(result.walkDirection, undefined); assert.deepEqual(result.extensions, {future: true});
  assert.equal(PARAMETER_FIELDS.length, 6);
});
test("positive/negative offsets shift both boundaries without mutating metadata", () => {
  const line = {start: 10, end: 15};
  assert.deepEqual(calibratedSegment(line, {audioOffsetMs: 250}), {start: 10.25, end: 15.25, playable: true});
  assert.deepEqual(calibratedSegment(line, {audioOffsetMs: -500}), {start: 9.5, end: 14.5, playable: true});
  assert.deepEqual(line, {start: 10, end: 15});
});
test("clip boundaries clamp to media duration and identify empty segments", () => {
  assert.deepEqual(calibratedSegment({start: 1, end: 4}, {audioOffsetMs: -2000}, 10), {start: 0, end: 2, playable: true});
  assert.deepEqual(calibratedSegment({start: 9, end: 15}, {audioOffsetMs: 2000}, 10), {start: 10, end: 10, playable: false});
  assert.equal(calibratedSegment({}, {audioOffsetMs: 1000}), undefined);
  assert.equal(calibratedSegment({start: 2, end: 1}, {}), undefined);
});

test("start and end can be calibrated independently, including invalid crossing boundaries", () => {
  assert.deepEqual(calibratedSegment({start: 10, end: 15}, {audioStartOffsetMs: -200, audioEndOffsetMs: 450}),
    {start: 9.8, end: 15.45, playable: true});
  assert.deepEqual(calibratedSegment({start: 10, end: 15}, {audioStartOffsetMs: 500, audioEndOffsetMs: -250}),
    {start: 10.5, end: 14.75, playable: true});
  assert.equal(calibratedSegment({start: 1, end: 2}, {audioStartOffsetMs: 3000}).playable, false);
});

test("v1 migration and partial updates retain the other endpoint and future data", () => {
  const migrated = normalizeParameters({schemaVersion: 1, audioOffsetMs: 250, extensions: {future: true}});
  assert.equal(migrated.audioStartOffsetMs, 250); assert.equal(migrated.audioEndOffsetMs, 250);
  const update = mergeParameters(migrated, {audioStartOffsetMs: -100, modelScalePercent: 90});
  assert.equal(update.audioEndOffsetMs, 250); assert.equal(update.audioStartOffsetMs, -100);
  assert.equal(update.modelScalePercent, 90); assert.deepEqual(update.extensions, {future: true});
  assert.equal(mergeParameters(update, {audioOffsetMs: 350}).audioEndOffsetMs, 350);
});

test("speech scales with the pet; manual base font and background transparency are independent", () => {
  assert.ok(speechMetrics({}, 0.3).fontSize < speechMetrics({}, 0.6).fontSize);
  assert.ok(speechMetrics({}, 1.2).fontSize > speechMetrics({}, 0.6).fontSize);
  assert.ok(speechMetrics({fontSizePx: 18}, 0.6).fontSize > speechMetrics({}, 0.6).fontSize);
  assert.equal(speechMetrics({bubbleTransparency: 100}).backgroundAlpha, 0);
  assert.equal(speechMetrics({bubbleTransparency: 0}).backgroundAlpha, 1);
  assert.ok(speechMetrics({}, 0.6, true).fontSize < speechMetrics({}, 0.6).fontSize);
  assert.equal(normalizeParameters({walkDirection: "none"}).walkDirection, undefined);
});
test("every walking start can choose either direction; preferences retain edge reversal", () => {
  assert.equal(chooseWalkDirection({}, () => 0.1), -1);
  assert.equal(chooseWalkDirection({}, () => 0.9), 1);
  assert.equal(chooseWalkDirection({walkDirection: "left"}, () => 0.9), 1);
  assert.equal(chooseWalkDirection({walkDirection: "right"}, () => 0.1), -1);
});

test('preview and pet share native scale and bubble coordinates; raising slider is reversed',()=>{
  const bounds={x:-50,y:-200,width:100,height:200};
  const small=modelLayout(bounds,252,300),large=modelLayout(bounds,504,600);
  assert.equal(large.scale,small.scale*2);assert.equal(small.y,294);
  assert.equal(bubbleTop({bubbleOffsetY:55},300,30,100),73);
  assert.equal(bubbleTop({},300,30,25),0);
  assert.equal(PARAMETER_FIELDS.find(x=>x.key==='bubbleOffsetY').reverse,true);
  assert.ok(!PARAMETER_FIELDS.some(x=>x.key==='walkDirection'));
});
test('undo groups slider drags, redo replays, a new edit replaces the redo branch',()=>{
  const history=createHistory({scale:60});history.begin();history.push({scale:65},true);history.push({scale:70},true);history.end();
  assert.deepEqual(history.undo(),{scale:60});assert.deepEqual(history.redo(),{scale:70});
  history.undo();history.push({scale:80});assert.equal(history.canRedo(),false);
  history.reset({scale:50});assert.equal(history.canUndo(),false);
});
