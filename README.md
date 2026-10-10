# Report Forge

Report Forge turns a spreadsheet into a stack of finished PDFs. You design a document once as an HTML template, point it at your data, and get one PDF per row (or per group of rows), plus an optional combined PDF.

It is a Windows desktop app. Everything runs on your computer: no account, no upload, no network access from templates.

## Download

1. Download `Report-Forge-<version>-win-x64.zip` from the [Releases](../../releases) page.
2. Right-click the zip, choose **Properties**, tick **Unblock**, and click **OK**. (The app is not code-signed yet; this step stops the Windows SmartScreen warning.)
3. Extract the zip anywhere and run **Report Forge.exe**.

## Quick start

1. Choose a template from the list at the top. Five examples are included.
2. Click **Open data file…** (or drop a file on the window). Each example folder contains a `sample-data` file you can try.
3. Check **Column mapping**. Columns are matched to template fields automatically; change any match from the drop-down. Your choices are remembered per template.
4. Click **Output folder…**, then **Generate All** (or tick some records and click **Generate Selected**). Tick **Also create one combined PDF** to get one file with every record as well.

Supported data files: Excel (`.xlsx`, `.xlsm`, `.xls`, `.xlsb`), OpenDocument (`.ods`), CSV, TSV/TXT, and JSON (an array of objects).

## Example templates

| Template | Shows |
|---|---|
| **Invoice** | Grouping rows into one document with a list of line items; a page that grows onto more sheets |
| **Certificate of Completion** | One document per row on a landscape page |
| **Quarterly Sales Summary** | A chart and totals drawn by a script from the record's data |
| **Event Badge** | A custom 4 × 3 in page; styling chosen by a data value; text shown only when a field is blank |
| **Member Welcome Letter** | A4 paper, today's date filled in automatically, a cut-out card |

## Making templates

Click **New template…** to start from a blank starter or a copy of the current template, then **Edit template** to open the visual editor. The editor has a page list (add, duplicate, reorder by dragging, delete), paper size and orientation, undo/redo, and a **Source** view for the HTML, CSS, and settings. Every save keeps a backup in the template's `.backups` folder.

Templates live in the `html` folder next to `Report Forge.exe` (**Open template folder** opens it). Each template is a folder:

```
html/my-report/
  template.html   the document, with {{fieldName}} where data goes
  template.css    styles (optional; linked from template.html)
  template.json   settings (optional)
  assets/         images, fonts, anything the template links to
```

### Fields

- `{{fieldName}}` is replaced with the value from the matching data column.
- `{{#items}} ... {{/items}}` repeats its content once per row of a group (see `groupBy` below).
- `{{^fieldName}} ... {{/fieldName}}` shows its content only when the field is blank.
- Built-in values: `{{today}}`, `{{recordNumber}}`, `{{recordCount}}`, `{{templateName}}`.

Templates use [Mustache](https://mustache.github.io/mustache.5.html) syntax.

### Pages

Each `<section class="page">` is one sheet of paper. Add the class `flow` (`<section class="page flow">`) for a page that grows onto more sheets when its content is long, such as a long table. The editor's paper size controls write the page size rules into `template.css` for you.

### template.json

```json
{
  "name": "Invoice",
  "filename": "Invoice {{invoiceNumber}} - {{customerName}}",
  "groupBy": "invoiceNumber",
  "list": "items",
  "locale": "en-US",
  "fields": {
    "invoiceNumber": { "label": "Invoice Number", "required": true },
    "invoiceDate":   { "label": "Invoice Date", "format": "date", "dateFormat": "MMM d, yyyy" },
    "amount":        { "label": "Amount", "format": "currency" },
    "notes":         { "label": "Notes", "blank": "—" }
  }
}
```

- `filename`: the PDF file name pattern (fields allowed).
- `groupBy` and `list`: rows with the same `groupBy` value become one document; their per-row fields are available inside `{{#list}} ... {{/list}}`.
- Field options: `label`, `aliases` (other column names to match), `required`, `format` (`text`, `currency`, `number`, `percent`, `date`), `decimals`, `currency`, `dateFormat`, and `blank` (text to show when the value is empty).

### Scripts and charts

Scripts in a template run while the PDF is made. The record's raw values are available as `window.reportData`. If a script draws something that takes time, set `window.reportReady` to a Promise; the PDF is printed when it resolves, and the record fails with your message if it rejects. The Quarterly Sales Summary example draws its chart this way.

## Building from source

Requirements: Windows, [Node.js](https://nodejs.org/) 26.

```
cd app
npm install
npm start          # run the app
npm test           # unit tests
npm run dist       # build dist/Report Forge (portable folder)
```

`npm run render-test` and `npm run editor-test` run end-to-end checks in Electron.

Releases are built by GitHub Actions: when `version` in `app/package.json` changes on `main`, the workflow tests, builds, zips, and publishes a release.

## Built with

- [Electron](https://www.electronjs.org/): the desktop app shell and the Chromium engine that prints the PDFs (MIT)
- [Mustache.js](https://github.com/janl/mustache.js): template fields, lists, and conditions (MIT)
- [SheetJS Community Edition](https://sheetjs.com/): reading Excel and OpenDocument files (Apache-2.0)
- [pdf-lib](https://pdf-lib.js.org/): combining PDFs into one file (MIT)
- [GrapesJS](https://grapesjs.com/): the visual template editor (BSD-3-Clause)
- [CodeMirror](https://codemirror.net/): the Source view code editors (MIT)
- [esbuild](https://esbuild.github.io/): bundling the editor (MIT)
- [electron-builder](https://www.electron.build/): packaging the Windows app (MIT)

## License

[MIT](LICENSE). Third-party licences for bundled libraries are listed in `THIRD_PARTY_NOTICES.txt` in the app folder.
