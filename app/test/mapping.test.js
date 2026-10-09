'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, autoMap, applyMapping, missingRequired } = require('../lib/mapping');

const F = (name, extra = {}) => ({ name, label: name, aliases: [], required: false, ...extra });

test('normalize', () => {
  assert.equal(normalize('Contact Name'), 'contactname');
  assert.equal(normalize('contact_name'), 'contactname');
  assert.equal(normalize(' Contact-Name '), 'contactname');
});

test('autoMap matches by name, label, and aliases', () => {
  const fields = [F('contactName'), F('balance', { label: 'Audited Balance' }), F('city', { aliases: ['Town'] }), F('zip')];
  const m = autoMap(['CONTACT NAME', 'Audited Balance', 'Town', 'Other'], fields);
  assert.deepEqual(m, { contactName: 'CONTACT NAME', balance: 'Audited Balance', city: 'Town', zip: null });
});

test('saved mapping wins while its column still exists', () => {
  const fields = [F('name')];
  assert.deepEqual(autoMap(['Name', 'Full Name'], fields, { name: 'Full Name' }), { name: 'Full Name' });
  assert.deepEqual(autoMap(['Name'], fields, { name: 'Gone' }), { name: 'Name' });
});

test('applyMapping renames columns to fields; unmapped fields are null', () => {
  const rows = [{ A: 1, B: 'x' }];
  assert.deepEqual(applyMapping(rows, { one: 'A', two: null }), [{ one: 1, two: null }]);
});

test('missingRequired lists labels of unmapped required fields', () => {
  const fields = [F('a', { required: true, label: 'Alpha' }), F('b', { required: true }), F('c')];
  assert.deepEqual(missingRequired(fields, { a: null, b: 'B', c: null }), ['Alpha']);
});
