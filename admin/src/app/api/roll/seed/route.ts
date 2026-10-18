/**
 * POST /api/roll/seed — re-import the extracted roll into Firestore.
 *
 * The seed has to use the **Admin SDK** (the Admin SDK bypasses
 * `firestore.rules`, which deny every client write to `voters`/`wards` — the
 * roll is imported data), and no service-account key belongs in a client
 * bundle. So instead of bolting `firebase-admin` onto the panel, this route
 * shells out to the script that already does the job correctly, with its
 * validations and its `--force` guard:
 *
 *     node ../mobile/scripts/seed-roll.mjs --force
 *
 * credentialed by the `FIREBASE_ADMIN_*` env vars from `admin/.env.local`
 * (lib/admin-firebase.ts) — the child process inherits `process.env`, and the
 * script reads the same vars, so no key file is needed anywhere. This route
 * exists for LOCAL runs of `next dev` (the honest production answer is a CI
 * job or a Cloud Function on Blaze, as elsewhere in this repo).
 *
 * Guards, deliberately blunt:
 *   - refuses to run in production builds (`next build` → Vercel or any
 *     shared host has no repo sibling and no key; serving this endpoint there
 *     would be an anonymous write path to the prod database);
 *   - `--force` only comes in through the body, so the destructive wipe of
 *     the existing `voters`/`wards` collections is an explicit request, not a
 *     GET that a link can fire — the script's own refusal ("already has
 *     voters") is the second line of defence either way.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { adminDb } from '@/lib/admin-firebase';

// No `export const runtime = 'nodejs'`: `cacheComponents` rejects route
// segment runtime config, and Node is the default runtime anyway.
//
// No `export const maxDuration` either: the full import writes 6,855
// documents through BulkWriter (minutes, not seconds) and Vercel's Hobby
// plan caps that value at 300 — but this route 403s in production anyway,
// and `next dev` has no such limit, so the long run only ever happens
// locally where the platform timeout does not apply.

const TAIL_LINES = 60;

function tail(text: string, lines = TAIL_LINES): string {
  return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return Response.json(
      { ok: false, error: 'Roll import is local-dev only — run scripts/seed-roll.mjs from the repo.' },
      { status: 403 }
    );
  }

  const repoRoot = path.resolve(process.cwd(), '..');
  const script = path.join(repoRoot, 'mobile', 'scripts', 'seed-roll.mjs');

  if (!existsSync(script)) {
    return Response.json(
      { ok: false, error: `Missing ${script}` },
      { status: 503 }
    );
  }
  // Validate the env creds HERE, before spawning a minutes-long import that
  // would die on the first write otherwise (the script reads the same vars).
  try {
    adminDb();
  } catch (caught) {
    return Response.json(
      { ok: false, error: caught instanceof Error ? caught.message : 'Admin SDK not configured.' },
      { status: 503 }
    );
  }

  let args = [script, '--force'];
  try {
    const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
    if (body?.dryRun === true) args = [script, '--dry-run'];
  } catch {
    // Malformed body: default to the full force import (matches the button).
  }

  const output = await new Promise<string>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: path.join(repoRoot, 'mobile'),
      env: {
        // FIREBASE_ADMIN_* flows through as-is — no key file involved.
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let buffer = '';
    const record = (chunk: Buffer | string) => {
      buffer += String(chunk);
    };
    child.stdout.on('data', record);
    child.stderr.on('data', record);

    const killTimer = setTimeout(() => child.kill('SIGKILL'), 9 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolve(`exit=${code}\n${buffer}`);
    });
    child.on('error', (error) => {
      clearTimeout(killTimer);
      resolve(`spawn error: ${error.message}\n${buffer}`);
    });
  });

  const ok = output.startsWith('exit=0');
  return Response.json({ ok, output: tail(output) });
}