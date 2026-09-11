import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identityMatches, identityWasSupplied, normalizeClassName, parseRecoveryMessage } from '../lib/invitations/identity.ts';

const student = { studentId: '041', name: 'CHIRAYU  SHARMA  ', className: 'IST LILY' };
test('AI tool arguments must come from details actually supplied by the user', () => {
  const input = { admissionNumber: '041', name: 'Chirayu Sharma', className: 'IST LILY' };
  assert.equal(identityWasSupplied(input, ['My admission number is 041', 'Chirayu Sharma, IST LILY']), true);
  assert.equal(identityWasSupplied(input, ['My admission number is 41', 'Chirayu Sharma, IST LILY']), false);
  assert.equal(identityWasSupplied(input, ['My admission number is 041', 'Chirayu, IST LILY']), false);
  assert.equal(identityWasSupplied(input, ['My admission number is 041', 'Chirayu Sharma']), false);
  assert.equal(identityWasSupplied(input, ['Find my invitation']), false);
});
test('all three identity fields match with harmless spacing and case differences', () => {
  assert.equal(identityMatches(student, { admissionNumber: ' 041 ', name: 'chirayu sharma', className: '1st lily' }), true);
});
test('never returns a match for a missing, partial, or incorrect identity field', () => {
  const correct = { admissionNumber: '041', name: 'Chirayu Sharma', className: 'IST LILY' };
  for (const change of [{ admissionNumber: '41' }, { admissionNumber: '0041' }, { name: 'Chirayu' }, { name: 'Chirayu Sarma' }, { className: 'IST LOTUS' }, { className: '' }, { name: '' }]) {
    assert.equal(identityMatches(student, { ...correct, ...change }), false);
  }
});
test('class aliases preserve the grade and section', () => {
  assert.equal(normalizeClassName('Class 1-Lily'), normalizeClassName('IST LILY'));
  assert.equal(normalizeClassName('2nd lotus'), normalizeClassName('2 LOTUS'));
  assert.notEqual(normalizeClassName('Tulip'), normalizeClassName('Tulip 1'));
  assert.notEqual(normalizeClassName('5TH DAISY'), normalizeClassName('5TH PANSY'));
});
test('labelled chat recovery preserves admission zeros and requires all fields', () => {
  assert.deepEqual(parseRecoveryMessage('Admission number: 041\nName: Chirayu Sharma\nClass: IST LILY'), { admissionNumber: '041', name: 'Chirayu Sharma', className: 'IST LILY' });
  assert.equal(parseRecoveryMessage('Name: Chirayu Sharma\nClass: IST LILY'), null);
  assert.equal(parseRecoveryMessage('Admission number: 041\nName: A\nName: B\nClass: IST LILY'), null);
});
