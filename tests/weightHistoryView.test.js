import test from 'node:test';
import assert from 'node:assert/strict';
import {UserDetailView} from '../src/features/users/UserDetailView.js';
import {UserDetailsEntity} from '../src/domain/user/UserDetailsEntity.js';

function render(raw) {
    const view = Object.create(UserDetailView.prototype);
    const element = () => ({textContent: '', innerHTML: '', setAttribute() {}});
    view._els = {weightBody: element(), weightSummary: element()};
    view._setBody = (body, html) => { body.innerHTML = html; };
    view._renderWeight({state: 'ready', entries: UserDetailsEntity.normalizeWeightHistory(raw), userHasProfile: true});
    return view._els.weightBody.innerHTML;
}

test('overview, plot and row changes exclude undated measurements from chronological comparisons', () => {
    const html = render([{weight: 50}, {weight: 90, createdAt: '2026-02-01'}, {weight: 80, createdAt: '2026-01-01'}]);
    assert.match(html, /Latest dated weight · \+10\.0 kg across 2 dated records/);
    assert.doesNotMatch(html, /\+40\.0|\+30\.0/);
    assert.match(html, /1 undated record is shown only in the table/);
    assert.equal((html.match(/class="weight-row"/g) || []).length, 3);
    assert.match(html, /preserveAspectRatio="none"/);
    assert.match(html, /class="weight-trend-axis"/);
});

test('unknown dates do not claim a latest weight, a timeline or a previous measurement', () => {
    const html = render([{weight: 50}, {weight: 80, createdAt: 'invalid'}]);
    assert.match(html, /2 measurements/);
    assert.match(html, /latest weight cannot be determined/);
    assert.match(html, /No dated measurements to plot/);
    assert.doesNotMatch(html, /<svg|Latest dated weight|\+30\.0/);
    assert.equal((html.match(/Unknown date/g) || []).length, 2);
});

test('multiple weights at the latest timestamp do not invent a unique latest weight or a net change', () => {
    const html = render([{weight: 80, createdAt: '2026-01-01'}, {weight: 82, createdAt: '2026-02-01'}, {weight: 84, createdAt: '2026-02-01'}]);
    assert.match(html, /Multiple weights share the latest timestamp/);
    assert.match(html, /2 measurements share timestamps; no order is assumed/);
    assert.doesNotMatch(html, /Latest dated weight|\+4\.0|\+2\.0/);
});

test('one measurement time has only markers and an explicit sparse-history message', () => {
    const html = render([{weight: 80, createdAt: '2026-01-01T09:00:00Z'}]);
    assert.match(html, /Only one measurement time; no time trend yet/);
    assert.match(html, /class="weight-trend-line" d=""/);
    assert.match(html, /class="weight-trend-point" d="M/);
});

test('axis labels retain exact quarter-kilogram midpoints instead of rounding a grid line to another value', () => {
    const html = render([{weight: 80, createdAt: '2026-01-01'}, {weight: 80.1, createdAt: '2026-01-02'}]);
    assert.match(html, /<span>80\.25 kg<\/span>/);
    assert.doesNotMatch(html, /<span>80\.3 kg<\/span>|style="top:/);
});

test('intraday labels distinguish seconds and milliseconds and keep UTC explicit', () => {
    const seconds = render([{weight: 80, createdAt: '2026-01-01T09:00:05Z'}, {weight: 81, createdAt: '2026-01-01T09:00:10Z'}]);
    assert.match(seconds, /<small>09:00:05 UTC<\/small>/);
    assert.match(seconds, /<small>09:00:10 UTC<\/small>/);
    const milliseconds = render([{weight: 80, createdAt: '2026-01-01T09:00:05.100Z'}, {weight: 81, createdAt: '2026-01-01T09:00:05.200Z'}]);
    assert.match(milliseconds, /<small>09:00:05\.100 UTC<\/small>/);
    assert.match(milliseconds, /<small>09:00:05\.200 UTC<\/small>/);
});

test('normalization retains epoch zero and impossible calendar dates remain unavailable in the table', () => {
    const html = render([{weight: 80, createdAt: 0}, {weight: 90, createdAt: '2026-02-30T09:00:00Z'}]);
    assert.match(html, /1970-01-01/);
    assert.match(html, /Unknown date/);
    assert.doesNotMatch(html, /2026-03-02|NaN|Infinity/);
    assert.match(html, /1 undated record/);
});
