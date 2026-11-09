import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registrationSummary} from '../lib/registration-summary.js';
test('participant counts deduplicate disciplines, keep namesakes separate and exclude closed entries',()=>{
  const rows=[
    {userId:'a',socId:'SOC-A',athleteName:'같은 이름',status:'REGISTERED',paymentStatus:'PAID'},
    {userId:'a',socId:'SOC-A',status:'REGISTERED',paymentStatus:'PENDING'},
    {socId:'SOC-A',status:'REGISTERED',paymentStatus:'UNPAID'},
    {userId:'b',athleteName:'같은 이름',status:'REGISTERED',paymentStatus:'PAID'},
    {userId:'c',status:'REGISTERED',paymentStatus:'REFUND_REQUESTED'},
    {userId:'d',status:'CANCELED',paymentStatus:'UNPAID'},
    {userId:'e',status:'REFUNDED',paymentStatus:'REFUNDED'},
    {athleteName:'미확인',status:'REGISTERED',paymentStatus:'UNPAID'}
  ];
  assert.deepEqual(registrationSummary(rows),{totalEntries:8,activeEntries:6,activeParticipants:3,confirmedParticipants:2,confirmedEntries:2,pendingEntries:3,refundRequestedEntries:1,canceledEntries:1,refundedEntries:1,unknownIdentityEntries:1});
  assert.equal(registrationSummary([]).activeParticipants,0);
});
