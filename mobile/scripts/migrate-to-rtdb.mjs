/**
 * Superseded by `seed-rtdb.mjs` — kept as a pointer so an old command in a
 * README, a shell history or another session still lands on the right script.
 *
 * This file could never have run, which is why it was replaced rather than
 * repaired in place:
 *
 *   - `getDatabase(app)` with no `databaseURL` throws "Unable to determine the
 *     default Firebase database URL" at import, so `main()` was unreachable.
 *   - `ref(`${path}/${key}`)` is the wrong arity — modular `ref` is
 *     `ref(db, path)`, so even past that it would not have compiled a ref.
 *   - voters were chunked into `votersByWard/{ward}/{chunkIndex}`, nesting the
 *     data under array positions and dropping the voter id as a key, which is
 *     a shape no reader in this app could consume.
 *   - `appConfig` was written to `/appConfig/latestVersion` instead of
 *     `/appConfig/general/latestVersion`.
 *   - `wards` was written as an array; RTDB turns arrays into `{"0": …}`,
 *     which does not match `wards/{wardNo}`.
 *
 * See `seed-rtdb.mjs` for the version that actually runs.
 *
 * A plain relative dynamic import: `import.meta.url` resolves it, so there is
 * no `pathToFileURL` dance to get wrong — which mattered, because the first
 * attempt passed `url.pathname` (a URL path, `/D:/…` on Windows) through
 * `pathToFileURL` and got ERR_MODULE_NOT_FOUND. The notice goes to stdout
 * rather than stderr because a successful redirect is not an error, and
 * stderr here is enough to make PowerShell report the whole command failed.
 */
console.log('migrate-to-rtdb.mjs has been replaced by seed-rtdb.mjs — running that instead.\n');

await import('./seed-rtdb.mjs');
