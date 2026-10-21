/**
 * The voter roll's mobile-number CSV — the bridge between a spreadsheet and
 * the same account-private overlay the bulk phone editor writes.
 *
 * One file format serves both directions:
 *
 *   Voter ID, EPIC ID, Name, Mobile Number
 *
 * `Voter ID` is the stable `w{ward}-{serial}` key, `EPIC ID` is the roll's
 * printed elector id, and `Name` exists so the operator can scan the sheet
 * without a second lookup. Import matches by Voter ID first and EPIC second;
 * the name is never an identity key. Blank number cells mean "leave this voter
 * alone", not "clear the saved number".
 *
 * Kept pure and browser-free so the page can export a Blob and the import
 * dialog can parse the same string without either half knowing about the
 * other.
 */
import { isValidPhone, phoneKey } from '@/lib/contacts';
import type { VoterView } from './types';

export const PHONE_CSV_HEADERS = [
  'Voter ID',
  'EPIC ID',
  'Name',
  'Mobile Number',
] as const;

type PhoneCsvColumn = 'id' | 'epic' | 'name' | 'phone';

/**
 * Header aliases, normalized by lowercasing and dropping everything that is
 * not a letter or digit. The exported labels are the canonical form; the
 * alternatives are there because an operator may delete and retype a header
 * while filling the sheet.
 */
const HEADER_ALIASES: Record<string, PhoneCsvColumn> = {
  voterid: 'id',
  voteridentifier: 'id',
  id: 'id',
  epicid: 'epic',
  epic: 'epic',
  epicno: 'epic',
  epicnumber: 'epic',
  electorid: 'epic',
  name: 'name',
  votername: 'name',
  electorname: 'name',
  mobile: 'phone',
  mobilenumber: 'phone',
  mobilephone: 'phone',
  phone: 'phone',
  phonenumber: 'phone',
  contact: 'phone',
  number: 'phone',
};

export interface PhoneCsvIssue {
  /** 1-based source line. The header is line 1. */
  line: number;
  message: string;
}

export interface PhoneCsvTarget {
  voter: VoterView;
  /** Normalized digits that will be written to the overlay. */
  phone: string;
  /** The name from the CSV, for the preview only. */
  csvName: string;
  /** 1-based source line. */
  line: number;
}

export interface PhoneCsvParse {
  /** A file-level problem (empty file, missing headers, unclosed quote). */
  error: string | null;
  /** Non-empty data rows, including rows that were skipped. */
  rows: number;
  /** Rows that will actually produce a write. */
  targets: PhoneCsvTarget[];
  /** Rows that could not be used, with a human-readable reason. */
  issues: PhoneCsvIssue[];
  /** Matched rows whose number already equals the overlay's number. */
  unchanged: number;
  /** Rows with an empty Mobile Number cell. */
  blank: number;
}

interface CsvRecord {
  cells: string[];
  line: number;
}

/* ----------------------------------------------------------------- export */

/** RFC 4180 escaping: commas, quotes and newlines force a quoted cell. */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Serializes voters exactly as the roll shows them: overlay name and overlay
 * phone, not the bundled base row. A saved number must survive a round trip.
 *
 * The UTF-8 BOM is deliberate — Excel needs it to detect Devanagari names as
 * UTF-8 instead of opening them as mojibake.
 */
export function phoneCsv(rows: readonly VoterView[]): string {
  const lines = [PHONE_CSV_HEADERS.map(csvCell).join(',')];

  for (const row of rows) {
    lines.push(
      [row.id, row.epicId, row.effective.name, row.effective.phone]
        .map(csvCell)
        .join(',')
    );
  }

  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** `voters-ward-02-2026-10-21.csv` — scope first, local date second. */
export function csvFileName(scope: string, date = new Date()): string {
  const slug =
    scope
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'voters';
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `voters-${slug}-${yyyy}-${mm}-${dd}.csv`;
}

/* ----------------------------------------------------------------- import */

/**
 * A small RFC 4180 reader. It handles the parts a spreadsheet actually emits:
 * quoted names with commas or quotes, CRLF/LF, a trailing newline and a UTF-8
 * BOM. It deliberately does not guess a delimiter; the exported file is comma
 * separated and the dialog tells the operator to edit that file.
 */
function parseCsv(text: string): { records: CsvRecord[]; error: string | null } {
  const clean = text.replace(/^\uFEFF/, '');
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];

    if (inQuotes) {
      if (char === '"') {
        if (clean[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
        if (char === '\n') line += 1;
      }
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      continue;
    }

    if (char === ',') {
      cells.push(field);
      field = '';
      continue;
    }

    if (char === '\r' || char === '\n') {
      cells.push(field);
      records.push({ cells, line: recordLine });
      cells = [];
      field = '';
      if (char === '\r' && clean[index + 1] === '\n') index += 1;
      line += 1;
      recordLine = line;
      continue;
    }

    field += char;
  }

  if (inQuotes) {
    return {
      records,
      error: 'The file has an unclosed quoted cell. Fix the quotes in the CSV and try again.',
    };
  }

  if (field !== '' || cells.length > 0) {
    cells.push(field);
    records.push({ cells, line: recordLine });
  }

  return { records, error: null };
}

function headerColumn(raw: string): PhoneCsvColumn | null {
  const key = raw
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return HEADER_ALIASES[key] ?? null;
}

function epicKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function emptyParse(error: string | null): PhoneCsvParse {
  return {
    error,
    rows: 0,
    targets: [],
    issues: [],
    unchanged: 0,
    blank: 0,
  };
}

/**
 * Parses an exported (or hand-filled) sheet against the signed-in account's
 * roll scope.
 *
 * Matching rules:
 *   - Voter ID wins. It is unique and stable.
 *   - EPIC is the fallback, and is only used when unique in the supplied
 *     scope; an EPIC that maps to two voters is reported, not guessed.
 *   - If both identifiers resolve but disagree, the row is rejected. That is
 *     exactly the mistake a spreadsheet cannot detect by itself.
 *   - Duplicate data rows for one voter are rejected after the first usable
 *     row, so a copy/paste slip cannot silently pick a winner.
 *
 * Rows are matched only against `voters` — the page passes the role-scoped
 * list, so a karykarta cannot update a voter outside their ward by editing an
 * id in the CSV.
 */
export function parsePhoneCsv(
  text: string,
  voters: readonly VoterView[]
): PhoneCsvParse {
  const parsed = parseCsv(text);
  if (parsed.error) return emptyParse(parsed.error);

  const header = parsed.records.find((record) =>
    record.cells.some((cell) => cell.trim() !== '')
  );
  if (!header) {
    return emptyParse(
      'The file is empty. Export a ward or selected voters from the roll, fill the Mobile Number column, then import that file.'
    );
  }

  const columns = new Map<PhoneCsvColumn, number>();
  header.cells.forEach((cell, index) => {
    const column = headerColumn(cell);
    if (column && !columns.has(column)) columns.set(column, index);
  });

  if (!columns.has('phone') || (!columns.has('id') && !columns.has('epic'))) {
    return emptyParse(
      'Expected the exported columns: Voter ID, EPIC ID, Name and Mobile Number. Keep at least Voter ID (or EPIC ID) and Mobile Number.'
    );
  }

  const byId = new Map<string, VoterView>();
  for (const voter of voters) {
    const key = voter.id.trim().toLowerCase();
    if (key && !byId.has(key)) byId.set(key, voter);
  }

  // `null` marks an EPIC shared by more than one voter. Using the map's
  // `undefined` for "absent" keeps the two cases distinct.
  const byEpic = new Map<string, VoterView | null>();
  for (const voter of voters) {
    const key = epicKey(voter.epicId);
    if (!key) continue;
    const existing = byEpic.get(key);
    if (existing === undefined) byEpic.set(key, voter);
    else if (existing && existing.id !== voter.id) byEpic.set(key, null);
  }

  const targets: PhoneCsvTarget[] = [];
  const issues: PhoneCsvIssue[] = [];
  const seen = new Map<string, number>();
  let rows = 0;
  let unchanged = 0;
  let blank = 0;

  const cell = (record: CsvRecord, column: PhoneCsvColumn): string => {
    const index = columns.get(column);
    return index === undefined ? '' : (record.cells[index] ?? '').trim();
  };

  for (const record of parsed.records) {
    if (record === header) continue;
    if (record.cells.every((value) => value.trim() === '')) continue;

    rows += 1;
    const rawId = cell(record, 'id');
    const rawEpic = cell(record, 'epic');
    const rawName = cell(record, 'name');
    const rawPhone = cell(record, 'phone');

    if (!rawPhone) {
      // A blank cell is the normal state of an unedited row in an exported
      // file, so it is a skip rather than an error.
      blank += 1;
      continue;
    }

    const idRow = rawId ? byId.get(rawId.toLowerCase()) : undefined;
    const epicValue = rawEpic ? byEpic.get(epicKey(rawEpic)) : undefined;
    const epicRow = epicValue === null ? undefined : epicValue;

    if (idRow && epicRow && idRow.id !== epicRow.id) {
      issues.push({
        line: record.line,
        message: `Voter ID and EPIC point to different voters (${idRow.id} vs ${epicRow.id}).`,
      });
      continue;
    }

    if (!idRow && epicValue === null) {
      issues.push({
        line: record.line,
        message: `EPIC ${rawEpic} matches more than one voter in this roll; use the Voter ID instead.`,
      });
      continue;
    }

    const voter = idRow ?? epicRow;
    if (!voter) {
      const identifier = rawId || rawEpic || 'this row';
      issues.push({
        line: record.line,
        message: `No voter matches ${identifier} in this account's roll.`,
      });
      continue;
    }

    if (!isValidPhone(rawPhone)) {
      issues.push({
        line: record.line,
        message: `${voter.effective.name}: "${rawPhone}" is not a usable mobile number.`,
      });
      continue;
    }

    if (seen.has(voter.id)) {
      issues.push({
        line: record.line,
        message: `${voter.effective.name} already appears on line ${seen.get(voter.id)}; only the first row was used.`,
      });
      continue;
    }
    seen.set(voter.id, record.line);

    const phone = phoneKey(rawPhone);
    if (phone === phoneKey(voter.effective.phone ?? '')) {
      unchanged += 1;
      continue;
    }

    targets.push({
      voter,
      phone,
      csvName: rawName || voter.effective.name,
      line: record.line,
    });
  }

  return {
    error: null,
    rows,
    targets,
    issues,
    unchanged,
    blank,
  };
}
