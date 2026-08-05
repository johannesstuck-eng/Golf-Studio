import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScorecardRows } from './scorecard-analysis.js';

test('parses the real Eichenried scorecard row structure into selectable tees', () => {
    const rows = [
        ['Loch', 'Herren weiß', 'Par', 'Vorgabe', 'Herren gelb', 'Par', 'Vorgabe', 'Damen blau', 'Par', 'Vorgabe', 'Damen rot', 'Par', 'Vorgabe'],
        ['A1', '395', '4', '5', '387', '4', '5', '353', '4', '5', '345', '4', '5'],
        ['A2', '163', '3', '7', '152', '3', '7', '137', '3', '7', '118', '3', '7'],
        ['A3', '409', '4', '3', '375', '4', '3', '345', '4', '3', '339', '4', '3'],
    ];
    const result = parseScorecardRows(rows, 3);
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.tees.map((tee) => tee.label), ['Weiß', 'Gelb', 'Blau', 'Rot']);
    assert.deepEqual(result.tees[1].holes[1], { number: 2, sourceLabel: 'A2', lengthMeters: 152, par: 3, strokeIndex: 7 });
});

test('refuses to invent missing hole rows', () => {
    const result = parseScorecardRows([['Loch', 'Gelb'], ['1', '350', '4', '5']], 9);
    assert.equal(result.status, 'manual');
    assert.equal(result.tees.length, 0);
    assert.match(result.warnings[0], /1 von 9/);
});
