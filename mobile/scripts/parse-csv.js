/**
 * RFC-4180 CSV reader, CommonJS on purpose.
 *
 * `scripts/build-roll.mjs` (ESM) imports it and `__tests__/roll-import.test.ts`
 * requires it — the shared implementation, not two copies. Keeping it `.js` in
 * a package without `"type": "module"` means plain Node and Jest can both load
 * it without a transform.
 *
 * Only the features the roll actually uses: quoted fields with `""` as an
 * escaped quote, CRLF or LF terminators, and a UTF-8 BOM — the ward files are
 * written `utf-8-sig` so Excel opens them, and that BOM would otherwise
 * corrupt `serial_no` on row 1.
 */

/**
 * @param {string} text
 * @returns {string[][]} rows of raw strings, header row first
 */
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }

  return rows;
}

/** Header + records in one call. Returns `null` for an empty file. */
function readCsvRows(text) {
  const rows = parseCsv(text);
  if (!rows.length) return null;
  const [header, ...body] = rows;
  return { header, rows: body };
}

module.exports = { parseCsv, readCsvRows };
