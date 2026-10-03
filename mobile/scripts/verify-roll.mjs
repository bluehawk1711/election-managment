#!/usr/bin/env node
/**
 * Read-only verification of the imported roll against `wards-summary.csv`.
 *
 *     GOOGLE_APPLICATION_CREDENTIALS=... node scripts/verify-roll.mjs
 *
 * Writes nothing. The seed's own post-write check only compares the grand
 * total, so a ward whose rows were scattered into the wrong ward — or a ward
 * whose genders were mangled — would still pass it. This re-reads the CSV,
 * counts what Firestore actually holds per ward and per gender, and prints the
 * disagreements instead of the totals that already matched.
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readCsvRows } = require('./parse-csv.js');

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const DATA_DIR = path.resolve(ROOT, '..', 'data/rajasthan/jodhpur/jhanwar/veernagar');

const FIRESTORE_DATABASE_ID = 'default';

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

const projectId =
  process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
  dotEnv.EXPO_PUBLIC_FIREBASE_PROJECT_ID ||
  JSON.parse(readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects?.default;

function readSummary() {
  const parsed = readCsvRows(
    readFileSync(path.join(DATA_DIR, 'wards-summary.csv'), 'utf8')
  );
  const col = new Map();
  parsed.header.forEach((name, i) => col.set(name.trim(), i));
  const at = (row, name) => (row[col.get(name)] ?? '').trim();
  return parsed.rows.map((row) => ({
    wardNo: Number(at(row, 'ward_no')),
    voters: Number(at(row, 'voters')),
    male: Number(at(row, 'male')),
    female: Number(at(row, 'female')),
    thirdGender: Number(at(row, 'third_gender')),
  }));
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('✖ GOOGLE_APPLICATION_CREDENTIALS is not set.');
    process.exit(1);
  }

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore(FIRESTORE_DATABASE_ID);

  const summary = readSummary();
  const problems = [];
  let expectedTotal = 0;
  let actualTotal = 0;

  const wardDocs = await db.collection('wards').orderBy('wardNo').get();
  const wards = new Map();
  wardDocs.docs.forEach((doc) => wards.set(doc.get('wardNo'), doc.data()));

  console.log(`Verifying ${projectId} (database "${FIRESTORE_DATABASE_ID}")\n`);

  for (const ward of summary) {
    expectedTotal += ward.voters;
    const meta = wards.get(ward.wardNo);
    if (!meta) {
      problems.push(`ward ${ward.wardNo}: no wards/${ward.wardNo} document`);
      continue;
    }
    if (meta.voterCount !== ward.voters) {
      problems.push(
        `ward ${ward.wardNo}: wards doc says ${meta.voterCount}, summary says ${ward.voters}`
      );
    }

    const rows = await db.collection('voters').where('wardNo', '==', ward.wardNo).get();
    actualTotal += rows.size;

    const tally = { male: 0, female: 0, other: 0 };
    rows.docs.forEach((doc) => {
      const data = doc.data();
      if (tally[data.gender] === undefined) tally[data.gender] = 0;
      tally[data.gender] += 1;
      // The client's rollVoterFromDoc reads these two labels back off the doc,
      // so a missing one would surface as a blank chip rather than an error.
      if (!data.epicId || !data.name) {
        problems.push(`voters/${doc.id}: missing epicId or name`);
      }
    });

    if (rows.size !== ward.voters) {
      problems.push(
        `ward ${ward.wardNo}: ${rows.size} voter docs, summary says ${ward.voters}`
      );
    }
    if (tally.male !== ward.male) {
      problems.push(`ward ${ward.wardNo}: ${tally.male} male, summary says ${ward.male}`);
    }
    if (tally.female !== ward.female) {
      problems.push(
        `ward ${ward.wardNo}: ${tally.female} female, summary says ${ward.female}`
      );
    }
    if (tally.other !== ward.thirdGender) {
      problems.push(
        `ward ${ward.wardNo}: ${tally.other} third gender, summary says ${ward.thirdGender}`
      );
    }
  }

  const voterCount = await db.collection('voters').count().get();
  if (voterCount.data().count !== expectedTotal) {
    problems.push(
      `collection total: ${voterCount.data().count}, summary says ${expectedTotal}`
    );
  }

  console.log(`  wards documents : ${wards.size} (expected ${summary.length})`);
  console.log(`  voters matching a ward : ${actualTotal}`);
  console.log(`  voters in collection  : ${voterCount.data().count} (expected ${expectedTotal})`);

  if (wards.size !== summary.length) {
    problems.push(`wards collection has ${wards.size} documents, expected ${summary.length}`);
  }

  if (problems.length) {
    console.error(`\n✖ ${problems.length} problem(s):`);
    problems.slice(0, 40).forEach((line) => console.error(`  - ${line}`));
    process.exit(1);
  }

  console.log('\n✔ Roll matches wards-summary.csv, ward by ward and gender by gender.\n');
}

main().catch((error) => {
  console.error(`\n✖ Verification failed: ${error.message}\n`);
  process.exit(1);
});