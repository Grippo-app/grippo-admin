import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWeightHistoryModel} from '../src/features/users/weightHistoryModel.js';

const row = (id, weight, createdAt) => ({id, weight, ...(createdAt === undefined ? {} : {createdAt})});
const finitePoints = model => {
    for (const point of model.points) {
        assert.ok(Number.isFinite(point.x) && point.x >= 0 && point.x <= 1);
        assert.ok(Number.isFinite(point.y) && point.y >= 0 && point.y <= 1);
    }
};

test('shuffled readings use real time gaps, stable input references and chronological chart points', () => {
    const newest = row('new', 82, '2026-01-11T00:00:00Z');
    const oldest = row('old', 80, '2026-01-01T00:00:00Z');
    const middle = row('middle', 81, '2026-01-02T00:00:00Z');
    const entries = Object.freeze([Object.freeze(newest), Object.freeze(oldest), Object.freeze(middle)]);
    const model = buildWeightHistoryModel(entries);
    assert.deepEqual(model.rows.map(value => value.entry), [newest, middle, oldest]);
    assert.deepEqual(model.rows.map(value => value.delta), [1, 1, null]);
    assert.deepEqual(model.points.map(point => point.entry), [oldest, middle, newest]);
    assert.deepEqual(model.points.map(point => point.x), [0, 0.1, 1]);
    assert.deepEqual(model.points.map(point => point.y), [0.75, 0.5, 0.25]);
    assert.equal(model.lineSegments.length, 1);
    assert.equal(model.lineSegments[0][0], model.points[0]);
    assert.equal(model.latestWeight, 82);
    assert.equal(model.latestTime, Date.parse(newest.createdAt));
    assert.equal(model.change, 2);
    assert.deepEqual(model.axis, {min: 79, mid: 81, max: 83});
    assert.deepEqual([model.datedCount, model.undatedCount, model.ambiguousCount, model.distinctTimeCount], [3, 0, 0, 3]);
    assert.deepEqual(entries, [newest, oldest, middle], 'source order and objects are never mutated');
    finitePoints(model);
});

test('same-time readings share one x position, never form a temporal line, and have no latest value or change', () => {
    const model = buildWeightHistoryModel([
        row('a', 80, '2026-10-15T12:00:00Z'),
        row('b', 81, '2026-10-15T15:00:00+03:00'),
    ]);
    assert.deepEqual(model.points.map(point => point.x), [0.5, 0.5]);
    assert.deepEqual(model.rows.map(value => value.delta), [null, null]);
    assert.deepEqual(model.lineSegments, []);
    assert.equal(model.latestWeight, null);
    assert.equal(model.latestTime, Date.parse('2026-10-15T12:00:00Z'));
    assert.equal(model.change, null);
    assert.equal(model.ambiguousCount, 2);
    assert.equal(model.distinctTimeCount, 1);
    finitePoints(model);
});

test('duplicate groups break lines and adjacent deltas while unique groups on either side remain usable', () => {
    const entries = [1, 2, 3, 3, 4, 5].map((day, index) => row(String(index), 80 + index, `2026-01-0${day}`));
    const model = buildWeightHistoryModel(entries);
    assert.deepEqual(model.lineSegments.map(segment => segment.map(point => point.entry.id)), [['0', '1'], ['4', '5']]);
    assert.equal(model.points[2].x, model.points[3].x);
    assert.deepEqual(model.rows.map(value => [value.entry.id, value.delta]), [
        ['5', 1], ['4', null], ['2', null], ['3', null], ['1', 1], ['0', null],
    ]);
    assert.equal(model.change, 5, 'unique endpoints still define a change despite an ambiguous interior time');
    assert.equal(model.points.length, entries.length);
    assert.equal(model.ambiguousCount, 2);
    finitePoints(model);
});

test('ambiguous latest or earliest groups cannot supply the overview change', () => {
    const latestAmbiguous = buildWeightHistoryModel([
        row('old', 80, '2026-01-01'), row('a', 81, '2026-01-02'), row('b', 82, '2026-01-02'),
    ]);
    assert.equal(latestAmbiguous.latestWeight, null, 'never substitute an older uniquely dated weight');
    assert.equal(latestAmbiguous.latestTime, Date.parse('2026-01-02T00:00:00Z'));
    assert.equal(latestAmbiguous.change, null);
    const earliestAmbiguous = buildWeightHistoryModel([
        row('a', 80, '2026-01-01'), row('b', 81, '2026-01-01'), row('new', 82, '2026-01-02'),
    ]);
    assert.equal(earliestAmbiguous.latestWeight, 82);
    assert.equal(earliestAmbiguous.change, null);
});

test('unknown-date 50kg remains in the table but dated 80 to 90kg changes by 10kg, never 40kg', () => {
    const undated = row('unknown', 50);
    const model = buildWeightHistoryModel([undated, row('new', 90, '2026-10-15'), row('old', 80, '2026-10-10')]);
    assert.deepEqual(model.rows.map(value => value.entry.id), ['new', 'old', 'unknown']);
    assert.deepEqual(model.rows.map(value => value.delta), [10, null, null]);
    assert.equal(model.rows.at(-1).entry, undated);
    assert.equal(model.rows.at(-1).timestamp, null);
    assert.equal(model.change, 10);
    assert.equal(model.latestWeight, 90);
    assert.deepEqual(model.points.map(point => point.weight), [80, 90]);
    assert.equal(model.undatedCount, 1);
    assert.deepEqual(model.axis, {min: 79, mid: 85, max: 91});
});

test('empty, all-undated and single-record models have explicit distinct states', () => {
    const empty = buildWeightHistoryModel();
    assert.deepEqual(empty, {rows: [], points: [], lineSegments: [], latestWeight: null, latestTime: null, change: null,
        axis: null, datedCount: 0, undatedCount: 0, ambiguousCount: 0, distinctTimeCount: 0});
    const unknown = buildWeightHistoryModel([row('a', 80), row('b', 81, '')]);
    assert.deepEqual(unknown.rows.map(value => [value.timestamp, value.delta]), [[null, null], [null, null]]);
    assert.equal(unknown.axis, null);
    assert.equal(unknown.latestWeight, null);
    assert.equal(unknown.latestTime, null);
    assert.equal(unknown.undatedCount, 2);
    const single = buildWeightHistoryModel([row('a', 80, '2026-01-01')]);
    assert.deepEqual(single.points.map(point => [point.x, point.y]), [[0.5, 0.5]]);
    assert.equal(single.latestWeight, 80);
    assert.equal(single.change, null);
    assert.deepEqual(single.lineSegments, []);
});

test('flat weights have padded nonzero bounds and finite horizontal coordinates', () => {
    const model = buildWeightHistoryModel([row('a', 80, '2026-01-01'), row('b', 80, '2026-01-02')]);
    assert.deepEqual(model.axis, {min: 79, mid: 80, max: 81});
    assert.deepEqual(model.points.map(point => point.y), [0.5, 0.5]);
    assert.equal(model.change, 0);
    assert.equal(model.rows[0].delta, 0);
    finitePoints(model);
});

test('epoch zero, finite Date objects and pre-epoch times are dated, without treating unknown dates as zero', () => {
    const model = buildWeightHistoryModel([
        row('unknown', 100), row('zero', 81, 0), row('pre', 80, new Date(-86400000)), row('next', 82, '1970-01-02T00:00:00Z'),
    ]);
    assert.deepEqual(model.rows.map(value => value.entry.id), ['next', 'zero', 'pre', 'unknown']);
    assert.deepEqual(model.points.map(point => point.timestamp), [-86400000, 0, 86400000]);
    assert.deepEqual(model.points.map(point => point.x), [0, 0.5, 1]);
    assert.equal(model.undatedCount, 1);
    assert.equal(model.change, 2);
});

test('strict calendar validation rejects rollover, ambiguous/timezoneless strings and unsupported values', () => {
    const invalidDates = ['2026-02-30', '2026-02-30T12:00:00Z', '2026-02-30T12:00:00+03:00',
        '2026-02-30 12:00:00', '10/15/2026', '0', '2026-10-15T12:00:00', new Date(NaN), Infinity, {}, [], true];
    const model = buildWeightHistoryModel(invalidDates.map((date, index) => row(String(index), 80, date)));
    assert.equal(model.undatedCount, invalidDates.length);
    assert.equal(model.datedCount, 0);
    assert.deepEqual(model.points, []);
    assert.equal(model.axis, null);
    assert.ok(model.rows.every(value => value.timestamp === null && value.delta === null));
    const leapDay = buildWeightHistoryModel([row('leap', 80, '2024-02-29')]);
    assert.equal(leapDay.points[0].timestamp, Date.parse('2024-02-29T00:00:00Z'));
});

test('intraday timestamps remain distinct and explicit offsets use the same elapsed-time scale', () => {
    const model = buildWeightHistoryModel([
        row('nine', 80, '2026-10-15T09:00:00Z'),
        row('ten', 81, '2026-10-15T13:00:00+03:00'),
        row('twelve', 82, '2026-10-15T12:00:00Z'),
    ]);
    assert.deepEqual(model.points.map(point => point.x), [0, 1 / 3, 1]);
    assert.equal(model.latestTime, Date.parse('2026-10-15T12:00:00Z'));
    assert.equal(model.distinctTimeCount, 3);
});

test('bounds pad each observed extreme by at least 1kg and round outward to 0.5kg', () => {
    const model = buildWeightHistoryModel([row('a', 80.1, '2026-01-01'), row('b', 80.2, '2026-01-02')]);
    assert.deepEqual(model.axis, {min: 79, mid: 80.25, max: 81.5});
    assert.ok(80.1 - model.axis.min >= 1);
    assert.ok(model.axis.max - 80.2 >= 1);
    assert.equal(model.axis.min * 2 % 1, 0);
    assert.equal(model.axis.max * 2 % 1, 0);
    assert.ok(Math.abs(model.points[1].y - model.points[0].y) < 0.05, 'a 0.1kg difference no longer fills the chart height');
    const nearZero = buildWeightHistoryModel([row('small', 0.1, '2026-01-01')]);
    assert.equal(nearZero.axis.min, 0, 'nonnegative scale takes precedence near zero');
    finitePoints(nearZero);
});

test('model keeps every measurement, including large same-time groups, without leaking metadata into source rows', () => {
    const entries = Array.from({length: 1000}, (_, index) => Object.freeze(row(String(index), 80 + index % 10 / 10, '2026-01-01')));
    const model = buildWeightHistoryModel(entries);
    assert.equal(model.rows.length, entries.length);
    assert.equal(model.points.length, entries.length);
    assert.equal(model.ambiguousCount, entries.length);
    assert.deepEqual(model.lineSegments, []);
    assert.equal(model.latestWeight, null);
    assert.ok(entries.every(entry => !Object.hasOwn(entry, 'x') && !Object.hasOwn(entry, 'delta') && !Object.hasOwn(entry, 'timestamp')));
    finitePoints(model);
});
