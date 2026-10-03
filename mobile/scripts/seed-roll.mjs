#!/usr/bin/env node
/**
 * Imports the extracted voter roll into Firestore.
 *
 *     pnpm run seed:roll              # refuses if `voters` already has data
 *     pnpm run seed:roll -- --dry-run # parse + validate only, writes nothing
 *     pnpm run seed:roll -- --force   # delete existing `voters`/`wards` first
 *
 * Source data — the CSVs `EXTRACTION.md` documents, byte-identical to what the
 * PDF extraction produced:
 *
 *     data/rajasthan/jodhpur/jhanwar/veernagar/ward-01..13.csv
 *     data/rajasthan/jodhpur/jhanwar/veernagar/wards-summary.csv
 *
 * Written to the `default` database (see `FIRESTORE_DATABASE_ID` below — NOT
 * `(default)`, which does not exist in this project) as two collections:
 *
 *     wards/{wardNo}   → wardNo, voterCount, male, female, thirdGender,
 *                        delimitation, boothNo, roomNo, boothAddress,
 *                        pdfPages, constituencyId, name
 *     voters/w{n}-{s}  → the CSV columns, plus genderLabel / relationLabel so
 *                        the client's `rollVoterFromDoc` round-trips without
 *                        re-deriving Hindi labels from English ones
 *
 * Everything is validated against `wards-summary.csv` before a single document
 * is written. A mismatch aborts: a half-imported roll is worse than none,
 * because the app cannot tell the difference between "not synced yet" and
 * "missing".
 *
 * Admin SDK on purpose — the client is denied write access to `voters` by
 * `firestore.rules` (the base roll is imported data, never user-editable).
 *
 * The `voters` collection holds 6,855 documents, which is past the 10k write
 * ceiling on a `setAll`-style batch, so writes go through `bulkWriter` at 500
 * per commit.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// `parse-csv.js` is CommonJS so that Jest and this ESM script can share one
// implementation; `import` of a CJS file works but has no types and no
// default-export ergonomics, so require it directly.
const require = createRequire(import.meta.url);
const { readCsvRows } = require('./parse-csv.js');

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');

// The roll lives one level above `mobile/`.
const DATA_DIR = path.resolve(
  ROOT,
  '..',
  'data/rajasthan/jodhpur/jhanwar/veernagar'
);

// Must match `FIRESTORE_DATABASE_ID` in `lib/firebase.ts`.
const FIRESTORE_DATABASE_ID = 'default';

const WARD_COUNT = 13;
const BATCH_SIZE = 500;

const CONSTITUENCY_ID = 'cons-jodhpur-jhanwar';
const WARDS_COLLECTION = 'wards';
const VOTERS_COLLECTION = 'voters';

// ---------------------------------------------------------------------------
// Arguments and project resolution
// ---------------------------------------------------------------------------

const dryRun = process.argv.includes('--dry-run');
const force = process.argv.includes('--force');
const projectFlagIndex = process.argv.indexOf('--project');
const projectFlag = projectFlagIndex === -1 ? null : process.argv[projectFlagIndex + 1];

/** Reads KEY=value lines out of a dotenv file, ignoring comments. */
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (match) out[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const dotEnv = {
  ...readEnvFile(path.join(ROOT, '.env')),
  ...readEnvFile(path.join(ROOT, '.env.local')),
};

function resolveProjectId() {
  const candidates = [
    projectFlag,
    process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    dotEnv.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  ];
  const fromEnv = candidates.find((value) => value && value.trim());
  if (fromEnv) return fromEnv.trim();

  const firebaserc = path.join(ROOT, '.firebaserc');
  if (existsSync(firebaserc)) {
    try {
      const id = JSON.parse(readFileSync(firebaserc, 'utf8')).projects?.default;
      if (id && id !== 'your-project-id') return id;
    } catch {
      // Fall through to the friendly error below.
    }
  }
  return null;
}

const projectId = resolveProjectId();

// ---------------------------------------------------------------------------
// CSV → rows
// ---------------------------------------------------------------------------

/** Devanagari labels as printed on the roll, mapped to the app's vocabulary. */
const GENDER_BY_LABEL = { 'पुरूष': 'male', 'स्त्री': 'female', 'तृतीयलिंग': 'other' };
const RELATION_BY_LABEL = { 'पिता': 'father', 'पति': 'husband', 'माता': 'mother', 'अन्य': 'other' };

/**
 * Index of each column by header name, so a reordered CSV cannot silently
 * write `houseNo` into `locality`. A missing required column is fatal.
 */
function headerIndex(header, file) {
  const index = new Map();
  header.forEach((name, i) => index.set(name.trim(), i));
  return index;
}

function readWardFile(wardNo) {
  const file = path.join(DATA_DIR, `ward-${String(wardNo).padStart(2, '0')}.csv`);
  if (!existsSync(file)) throw new Error(`Missing ${file}`);

  const parsed = readCsvRows(readFileSync(file, 'utf8'));
  if (!parsed) throw new Error(`${file} is empty`);

  const col = headerIndex(parsed.header, file);
  const required = [
    'serial_no', 'epic_id', 'name', 'relation', 'father_or_husband_name',
    'house_no', 'age', 'gender', 'locality', 'pdf_page',
  ];
  for (const name of required) {
    if (!col.has(name)) throw new Error(`${file}: missing column "${name}"`);
  }

  const problems = [];
  const voters = [];

  parsed.rows.forEach((row, index) => {
    const lineNo = index + 2; // header is line 1
    const at = (name) => (row[col.get(name)] ?? '').trim();

    const serialNo = Number(at('serial_no'));
    const age = Number(at('age'));
    const pdfPage = Number(at('pdf_page'));
    const genderLabel = at('gender');
    const relationLabel = at('relation');

    if (!Number.isInteger(serialNo) || serialNo <= 0) {
      problems.push(`ward-${wardNo} line ${lineNo}: bad serial_no "${at('serial_no')}"`);
    }
    if (!Number.isInteger(age) || age < 0) {
      problems.push(`ward-${wardNo} line ${lineNo}: bad age "${at('age')}"`);
    }
    if (!Number.isInteger(pdfPage)) {
      problems.push(`ward-${wardNo} line ${lineNo}: bad pdf_page "${at('pdf_page')}"`);
    }
    const gender = GENDER_BY_LABEL[genderLabel];
    if (!gender) {
      problems.push(`ward-${wardNo} line ${lineNo}: unknown gender "${genderLabel}"`);
    }
    const relation = RELATION_BY_LABEL[relationLabel];
    if (!relation) {
      problems.push(`ward-${wardNo} line ${lineNo}: unknown relation "${relationLabel}"`);
    }
    if (row.length !== parsed.header.length) {
      problems.push(
        `ward-${wardNo} line ${lineNo}: ${row.length} fields, header has ${parsed.header.length}`
      );
    }

    if (problems.length > 20) return; // stop collecting, the abort below reports

    voters.push({
      id: `w${wardNo}-${serialNo}`,
      wardNo,
      serialNo,
      epicId: at('epic_id'),
      name: at('name'),
      relation,
      relationLabel: relationLabel || 'पिता',
      fatherOrHusbandName: at('father_or_husband_name'),
      houseNo: at('house_no'),
      age: Number.isFinite(age) ? age : 0,
      gender: gender ?? 'male',
      genderLabel: genderLabel || 'पुरूष',
      locality: at('locality'),
      pdfPage: Number.isFinite(pdfPage) ? pdfPage : 0,
    });
  });

  if (problems.length) {
    throw new Error(`\n  - ${problems.slice(0, 20).join('\n  - ')}`);
  }

  // Duplicate ids would make `writer.set` overwrite a row in place — the kind of
  // data loss that shows up as "the roll has fewer voters than the summary
  // says" and takes an afternoon to find.
  const ids = new Set(voters.map((voter) => voter.id));
  if (ids.size !== voters.length) {
    throw new Error(`ward-${wardNo}: ${voters.length - ids.size} duplicate serial_no`);
  }

  return voters;
}

function readSummary() {
  const file = path.join(DATA_DIR, 'wards-summary.csv');
  if (!existsSync(file)) throw new Error(`Missing ${file}`);

  const parsed = readCsvRows(readFileSync(file, 'utf8'));
  if (!parsed) throw new Error(`${file} is empty`);

  const col = headerIndex(parsed.header, file);
  const at = (row, name) => (row[col.get(name)] ?? '').trim();

  return parsed.rows.map((row) => ({
    wardNo: Number(at(row, 'ward_no')),
    voters: Number(at(row, 'voters')),
    male: Number(at(row, 'male')),
    female: Number(at(row, 'female')),
    thirdGender: Number(at(row, 'third_gender')),
    delimitation: at(row, 'ward_delimitation'),
    boothNo: Number(at(row, 'booth_no')),
    roomNo: Number(at(row, 'room_no')),
    boothAddress: at(row, 'booth_address'),
    pdfPages: at(row, 'pdf_pages'),
  }));
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Cross-checks every ward's parsed rows against `wards-summary.csv` and
 * returns the totals, or throws with the full list of disagreements.
 */
function validate(summary, byWard) {
  const problems = [];
  const sum = (key) => summary.reduce((total, ward) => total + ward[key], 0);

  if (summary.length !== WARD_COUNT) {
    problems.push(`wards-summary.csv has ${summary.length} wards, expected ${WARD_COUNT}`);
  }

  const expectedTotal = sum('voters');
  const actualTotal = [...byWard.values()].reduce((total, rows) => total + rows.length, 0);
  if (actualTotal !== expectedTotal) {
    problems.push(`total voters: parsed ${actualTotal}, summary ${expectedTotal}`);
  }

  for (const ward of summary) {
    const rows = byWard.get(ward.wardNo);
    if (!rows) {
      problems.push(`ward ${ward.wardNo}: no CSV found`);
      continue;
    }
    if (rows.length !== ward.voters) {
      problems.push(`ward ${ward.wardNo}: parsed ${rows.length} voters, summary ${ward.voters}`);
    }

    const tally = { male: 0, female: 0, other: 0 };
    for (const voter of rows) tally[voter.gender] += 1;
    if (tally.male !== ward.male) {
      problems.push(`ward ${ward.wardNo}: ${tally.male} male, summary ${ward.male}`);
    }
    if (tally.female !== ward.female) {
      problems.push(`ward ${ward.wardNo}: ${tally.female} female, summary ${ward.female}`);
    }
    if (tally.other !== ward.thirdGender) {
      problems.push(`ward ${ward.wardNo}: ${tally.other} third gender, summary ${ward.thirdGender}`);
    }
  }

  if (problems.length) {
    throw new Error(`Roll does not match wards-summary.csv:\n  - ${problems.join('\n  - ')}`);
  }

  return {
    voters: expectedTotal,
    wards: summary.length,
    male: sum('male'),
    female: sum('female'),
    other: sum('thirdGender'),
  };
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Reading ${DATA_DIR}`);

  const summary = readSummary();
  const byWard = new Map();
  for (let wardNo = 1; wardNo <= WARD_COUNT; wardNo += 1) {
    byWard.set(wardNo, readWardFile(wardNo));
  }

  const totals = validate(summary, byWard);

  console.log(
    `✔ Validated ${totals.voters} voters across ${totals.wards} wards ` +
      `(${totals.male} male, ${totals.female} female, ${totals.other} other)`
  );

  if (dryRun) {
    console.log('\n--dry-run: nothing written.\n');
    return;
  }

  if (!projectId) {
    console.error(
      '✖ No project id.\n' +
        '  Pass one:   pnpm run seed:roll -- --project <id>\n' +
        '  Or set EXPO_PUBLIC_FIREBASE_PROJECT_ID in .env.local,\n' +
        '  or replace the placeholder in .firebaserc.\n'
    );
    process.exit(1);
  }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      '✖ GOOGLE_APPLICATION_CREDENTIALS is not set.\n' +
        '  Point it at a service-account JSON with Firestore write access:\n\n' +
        '    export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"\n'
    );
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore(FIRESTORE_DATABASE_ID);

  // 1. Refuse to overwrite an existing roll without --force. Re-running this
  //    against a project that already has the roll is how you get a half-updated
  //    collection, and the client cannot detect it.
  const existing = await db.collection(VOTERS_COLLECTION).limit(1).get();
  if (!existing.empty && !force) {
    console.error(
      `✖ Project "${projectId}" (database "${FIRESTORE_DATABASE_ID}") already has voters.\n` +
        '  Re-run with --force to delete `voters` and `wards` and reimport:\n\n' +
        '    pnpm run seed:roll -- --force\n'
    );
    process.exit(1);
  }

  if (!existing.empty) {
    console.log(`Clearing existing ${VOTERS_COLLECTION} / ${WARDS_COLLECTION}…`);
    for (const name of [VOTERS_COLLECTION, WARDS_COLLECTION]) {
      const snapshot = await db.collection(name).get();
      if (snapshot.empty) continue;
      const writer = db.bulkWriter();
      for (const doc of snapshot.docs) writer.delete(doc.ref);
      await writer.close();
      console.log(`  cleared ${name} (${snapshot.size})`);
    }
  }

  // 2. Wards. `name` is what `getWards()` orders by, and the app's ward chips
  //    render it — the delimitation text is long and the ward number is not,
  //    so the chip-friendly name is the constituency name plus the number.
  const writer = db.bulkWriter();
  for (const ward of summary) {
    writer.set(db.collection(WARDS_COLLECTION).doc(String(ward.wardNo)), {
      wardNo: ward.wardNo,
      name: `वार्ड ${ward.wardNo}`,
      voterCount: ward.voters,
      male: ward.male,
      female: ward.female,
      thirdGender: ward.thirdGender,
      delimitation: ward.delimitation,
      boothNo: ward.boothNo,
      roomNo: ward.roomNo,
      boothAddress: ward.boothAddress,
      pdfPages: ward.pdfPages,
      constituencyId: CONSTITUENCY_ID,
    });
  }
  await writer.close();

  // 3. Voters. `id` is stripped — it is the document id, and the client's
  //    `rollVoterFromDoc` reads `doc.id`, never a field. `bulkWriter` takes the
  //    rate limit into account itself; the batch is closed every BATCH_SIZE so
  //    the write stream stays inside memory limits on a low-end phone-turned
  //    laptop and progress can be printed.
  let batch = db.bulkWriter();
  let pending = 0;
  let written = 0;

  for (const rows of byWard.values()) {
    for (const voter of rows) {
      const { id, ...fields } = voter;
      batch.set(db.collection(VOTERS_COLLECTION).doc(id), fields);
      pending += 1;
      if (pending === BATCH_SIZE) {
        await batch.close();
        process.stdout.write(`  ${written + pending}/${totals.voters}\r`);
        written += pending;
        pending = 0;
        batch = db.bulkWriter();
      }
    }
  }
  await batch.close();
  written += pending;
  process.stdout.write(`  ${written}/${totals.voters}\n`);

  // 4. Read back and compare. A seed that reports success but wrote 6,800
  //    documents is worse than one that fails loudly.
  const check = await db.collection(VOTERS_COLLECTION).count().get();
  const writtenCount = check.data().count;
  if (writtenCount !== totals.voters) {
    console.error(
      `\n✖ Wrote ${writtenCount} voters, expected ${totals.voters}. ` +
        'The import is incomplete — re-run with --force.\n'
    );
    process.exit(1);
  }

  console.log(
    `\n✔ Seeded ${writtenCount} voters + ${summary.length} wards into ` +
      `${projectId} (database "${FIRESTORE_DATABASE_ID}")\n`
  );
  console.log('  The app reads `wards` and `voters` read-only; user edits live in');
  console.log('  the local overlay and never touch these documents.\n');
}

main().catch((error) => {
  console.error(`\n✖ Roll import failed: ${error.message}\n`);
  process.exit(1);
});