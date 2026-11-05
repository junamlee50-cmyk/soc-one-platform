import crypto from 'node:crypto';

export function signingKey() {
  const key = process.env.SOC_TICKET_SIGNING_KEY || '';
  if (key.length < 32) throw new Error('ticket_signing_not_configured');
  return key;
}

export const ticketSign = id => crypto.createHmac('sha256', signingKey()).update(id).digest('base64url').slice(0, 24);

export function validTicketSignature(id, signature) {
  const expected = Buffer.from(ticketSign(id));
  const actual = Buffer.from(signature);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
