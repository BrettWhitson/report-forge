'use strict';
// The example templates in html/ must work out of the box with the sample data file next to each one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createController } = require('../main/controller');
const { createSettings } = require('../main/settings');
const { validateBundle, readBundle } = require('../main/editor-files');
const { tempDir } = require('./helpers');

const HTML_DIR = path.join(__dirname, '..', '..', 'html');
const EXAMPLES = {
  'invoice': { file: 'sample-data.xlsx', records: 5 },
  'certificate': { file: 'sample-data.csv', records: 6 },
  'sales-summary': { file: 'sample-data.json', records: 4 },
  'event-badge': { file: 'sample-data.csv', records: 8 },
  'welcome-letter': { file: 'sample-data.tsv', records: 4 },
};

function controller() {
  const settings = createSettings(path.join(tempDir(), 's.json'));
  return createController({ htmlDir: HTML_DIR, settings, renderPdf: async () => {}, today: new Date(2026, 9, 10) });
}

test('html/ ships exactly the example templates', () => {
  const ids = fs.readdirSync(HTML_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  assert.deepEqual(ids, Object.keys(EXAMPLES).sort());
});

for (const [id, expected] of Object.entries(EXAMPLES)) {
  test(`example "${id}" builds every sample record with nothing missing and no warnings`, () => {
    const c = controller();
    const t = c.selectTemplate(id);
    assert.equal(t.templateError, null);
    const s = c.loadData(path.join(HTML_DIR, id, expected.file));
    assert.equal(s.dataError, null);
    assert.deepEqual(s.missing, []);
    assert.deepEqual(s.unmapped, [], 'every field should auto-match a sample column');
    assert.deepEqual(s.issues, []);
    assert.equal(s.records.length, expected.records);
    for (const r of s.records) {
      assert.deepEqual(r.warnings, [], `${id}: ${r.title}`);
      assert.equal(r.skipped, false);
    }
    assert.equal(new Set(s.records.map((r) => r.title)).size, s.records.length, 'file names are unique');
  });

  test(`example "${id}" opens cleanly in the editor (linked stylesheet, valid settings)`, () => {
    const b = readBundle(path.join(HTML_DIR, id));
    assert.equal(b.cssFile, 'template.css');
    assert.match(b.css, /Report Forge page setup \(managed by the editor\)/);
    assert.equal(validateBundle(b), null);
  });
}
