const { parseCsv } = require('../scripts/parse-csv.js');

describe('build-roll CSV parsing', () => {
  it('parses a quoted field containing commas', () => {
    const rows = parseCsv('a,b\n1,"बाबा रामदेव नगर,सांगरिया"\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', 'बाबा रामदेव नगर,सांगरिया'],
    ]);
  });

  it('parses escaped quotes', () => {
    const rows = parseCsv('a\n"say ""hi"""\n');
    expect(rows[1][0]).toBe('say "hi"');
  });

  it('handles CRLF terminators', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('strips the UTF-8 BOM that utf-8-sig writes', () => {
    const rows = parseCsv('﻿serial_no\n1\n');
    expect(rows[0][0]).toBe('serial_no');
  });

  it('keeps an empty quoted field as an empty string', () => {
    const rows = parseCsv('a,b\n"",x\n');
    expect(rows[1]).toEqual(['', 'x']);
  });
});
