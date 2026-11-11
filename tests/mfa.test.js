import {test} from 'node:test';
import assert from 'node:assert/strict';
import {totp,base32,encryptSecret,decryptSecret,matchCounter} from '../lib/mfa.js';

test('TOTP matches RFC 6238 SHA-1 reference vectors',()=>{
 const secret=Buffer.from('12345678901234567890');
 for(const [seconds,code]of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(totp(secret,seconds*1000,8),code);
 assert.equal(base32(Buffer.from('foobar')),'MZXW6YTBOI');
});
test('OTP replay, expired window, wrong format, key tampering, and user swapping fail',()=>{
 process.env.SOC_MFA_ENCRYPTION_KEY='ab'.repeat(32);
 const secret=Buffer.alloc(20,7),at=1234567890000,counter=Math.floor(at/30000),code=totp(secret,at);
 assert.equal(matchCounter(secret,code,-1,at),counter);
 assert.equal(matchCounter(secret,code,counter,at),null);
 assert.equal(matchCounter(secret,code,-1,at+90000),null);
 assert.equal(matchCounter(secret,'12345',-1,at),null);
 const encrypted=encryptSecret(secret,'u1');assert.deepEqual(decryptSecret(encrypted,'u1'),secret);
 assert.throws(()=>decryptSecret(encrypted,'u2'));assert.throws(()=>decryptSecret({...encrypted,tag:'00'.repeat(16)},'u1'));
 delete process.env.SOC_MFA_ENCRYPTION_KEY;assert.throws(()=>encryptSecret(secret,'u1'));
});
