import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const sandbox={};runInNewContext(readFileSync(new URL('../assets/date-input.js',import.meta.url),'utf8'),sandbox);const {parse,iso,toInput,display}=sandbox.SOCDate;
test('date and date-time accept continuous typing and preserve Korean calendar values',()=>{
 assert.equal(parse('19780405'),'1978-04-05');assert.equal(parse('202611101430','datetime'),'2026-11-10T14:30');
 for(const v of ['2026-11-10T14:30','2026-11-10 14:30','2026/11/10 14:30'])assert.equal(iso(v),'2026-11-10T05:30:00.000Z');
 assert.equal(iso('202611101430'),'2026-11-10T05:30:00.000Z');assert.equal(toInput('2026-11-10T05:30:00.000Z'),'2026-11-10 14:30');assert.equal(display('202611101430','datetime'),'2026-11-10 14:30');
});
test('invalid dates, incomplete times, and ambiguous short fields never normalize silently',()=>{
 for(const v of ['197804-05-일','20260230','20261301','2026111','202611100','18990101','2026-1-1','2026--11--10'])assert.equal(parse(v),null);
 for(const v of ['20261110','202611102400','202611101460','20261110143','20261110143059','202602301200','2026-11-10T14:30:00+09:00'])assert.equal(parse(v,'datetime'),null);
 assert.equal(parse('20240229'),'2024-02-29');assert.equal(parse('21000229'),null);assert.equal(iso('invalid'),null);assert.equal(iso(''),'');
});
test('midnight and end-of-day round trip across UTC dates and browser time zones',()=>{
 assert.equal(iso('202701010000'),'2026-12-31T15:00:00.000Z');assert.equal(iso('202612312359'),'2026-12-31T14:59:00.000Z');
 for(const input of ['202402290001','202612312359','202701010000'])assert.equal(parse(toInput(iso(input)),'datetime'),parse(input,'datetime'));
});
