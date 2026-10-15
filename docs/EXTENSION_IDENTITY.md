# Extension identity and ID stability

The extension ships a public key in `public/manifest.json` (`"key"` field).
For **Load unpacked** installs, Chrome derives the extension ID from the
first 128 bits of SHA-256 over that DER public key — so the ID is pinned to
this repository and stays stable across installs and machines:

```
pinned extension ID: pieeojhacbmcmkfakahpapgpmejgnaij
```

## Why this matters

- Users' granted optional host permissions, `chrome.storage.local` flags and
  browser-history associations (e.g. "allow this extension to run on
  example.org") are keyed to the extension ID. A drifting ID silently resets
  them.
- Documentation and support material can reference the stable ID.

## Key material

- **Public half:** embedded in `public/manifest.json` (committed). Safe to
  publish; it only pins the ID.
- **Private half:** `keys/local-notes-web-archive.pem` (gitignored, never
  committed). Required only for producing a signed `.crx` for forced
  installs; the plain unpacked `dist/` folder never needs it.

The keypair was generated once with `node scripts/generate-identity.mjs`.
That script is idempotent and **refuses to overwrite** an existing key,
because rotating the key changes the extension ID and orphans every
installed copy's permissions.

## If the private key is lost

- Unpacked installs keep working; the pinned ID remains in effect via the
  committed public key.
- Producing a future signed `.crx` from the same ID becomes impossible. A
  new keypair (deliberately deleting `keys/…`) means a new extension ID —
  treat that as a new product identity and document the migration.

## Icons

`public/icons/icon-{16,32,48,128}.png` are generated deterministically by
`node scripts/generate-icons.mjs` (pure geometry, 4x supersampling, no
randomness). Regeneration produces byte-identical files; the unit suite
(`dev/tests/unit/manifest.test.ts`) asserts that the committed icons equal the
script output, so a hand-edited icon is a build failure, not a silent
regression.
