import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://localhost:3100';
let failed = 0;
for (const [method, path, body] of [
  ['POST', '/api/invitations', {studentId:'unauthorized',name:'Must not be created'}],
  ['GET', '/api/tickets'],
  ['GET', '/api/check-in?qrToken=invalid'],
  ['POST', '/api/check-in', {qrToken:'invalid'}],
  ['GET', '/api/admin'],
  ['POST', '/api/tickets', {studentId:'10234',description:'Must not be created'}],
]) {
  const res = await fetch(base + path, {method, headers:{'content-type':'application/json'}, body: body ? JSON.stringify(body) : undefined});
  try { assert.equal(res.status, 401); console.log('PASS', method, path, 'requires authorization'); }
  catch { failed++; console.log('FAIL', method, path, 'expected 401, got', res.status); }
}
process.exitCode = failed ? 1 : 0;
