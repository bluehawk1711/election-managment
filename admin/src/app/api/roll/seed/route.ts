/**
 * POST /api/roll/seed — re-import the migrated data into the Realtime
 * Database.
 *
 * The seed has to use the **Admin SDK** (it bypasses `database.rules`, which
 * deny every client write to `votersByWard`/`wards` — the roll is imported
 * data), and no service-account key belongs in a client bundle. So instead of
 * bolting `firebase-admin` onto the panel, this route shells out to the
 * script that already does the job correctly, with its validations:
 *
 *     node ../mobile/scripts/seed-rtdb.mjs
 *
 * with `--dry-run` when the caller asks for one. The script reads the same
 * `mobile/service-account.json` the rest of the repo's one-off scripts use,
 * so this route only has to prove the file is there before spawning — the
 * key never enters a Next.js module, and never leaves the machine.
 *
 * This route exists for LOCAL runs of `next dev` (the honest production
 * answer is a CI job or a Cloud Function on Blaze, as elsewhere in this repo).
 *
 * Guards, deliberately blunt:
 *   - refuses to run in production builds (`next build` → Vercel or any
 *     shared host has no repo sibling and no key; serving this endpoint there
 *     would be an anonymous write path to the prod database);
 *   - nothing here runs on GET, so a link cannot fire an import.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// No `export const runtime = 'nodejs'`: `cacheComponents` rejects route
// segment runtime config, and Node is the default runtime anyway.
//
// No `export const maxDuration` either: the full import writes every node
// through the Admin SDK (minutes, not seconds) and Vercel's Hobby plan caps
// that value at 300 — but this route 403s in production anyway, and `next
// dev` has no such limit, so the long run only ever happens locally where the
// platform timeout does not apply.

const TAIL_LINES = 60;

function tail(text: string, lines = TAIL_LINES): string {
  return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return Response.json(
      { ok: false, error: 'Data import is local-dev only — run scripts/seed-rtdb.mjs from the repo.' },
      { status: 403 }
    );
  }

  const repoRoot = path.resolve(process.cwd(), '..');
  const mobileRoot = path.join(repoRoot, 'mobile');
  const script = path.join(mobileRoot, 'scripts', 'seed-rtdb.mjs');
  // The script's own credential source — it reads this file directly rather
  // than loading NEXT_PUBLIC_ vars into Node, so a missing key is a hard
  // stop HERE rather than a spawned process that dies on its first write.
  const serviceAccount = path.join(mobileRoot, 'service-account.json');

  if (!existsSync(script)) {
    return Response.json({ ok: false, error: `Missing ${script}` }, { status: 503 });
  }
  if (!existsSync(serviceAccount)) {
    return Response.json(
      { ok: false, error: `Missing ${serviceAccount} — the RTDB import reads the same key file as the other mobile scripts.` },
      { status: 503 }
    );
  }

  // Validate the Admin SDK env HERE, before spawning a minutes-long import
  // that would die on the first write otherwise.
  try {
    // Dynamic import: this route's production guard above must still return
    // its normal 403 even if the Admin SDK cannot load on the host.
    const { adminDatabase } = await import('@/lib/admin-firebase');
    adminDatabase();
  } catch (caught) {
    return Response.json(
      { ok: false, error: caught instanceof Error ? caught.message : 'Admin SDK not configured.' },
      { status: 503 }
    );
  }

  let args = [script];
  try {
    const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean };
    if (body?.dryRun === true) args = [script, '--dry-run'];
  } catch {
    // Malformed body: default to the full import (matches the button).
  }

  const output = await new Promise<string>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: mobileRoot,
      env: {
        PYTHONIOENCODING: 'utf-8',
        ...process.env,
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
