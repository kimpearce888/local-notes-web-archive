/**
 * Extension identity generator (plan T-013): creates an RSA-2048 keypair
 * whose PUBLIC half is written into public/manifest.json ("key") to pin the
 * extension ID for unpacked installs (Chrome derives the ID from
 * SHA-256 of the DER public key). The PRIVATE half is written to
 * keys/local-notes-web-archive.pem for future CRX signing and MUST never be
 * committed (keys/ is gitignored).
 *
 * Idempotent: refuses to overwrite an existing key so the pinned identity
 * can never silently rotate. Regenerating the key changes the extension ID.
 *
 * Usage: node scripts/generate-identity.mjs
 */

import { generateKeyPairSync, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pemPath = join(root, 'keys', 'local-notes-web-archive.pem');
const manifestPath = join(root, 'public', 'manifest.json');

/** Chrome extension ID: first 128 bits of SHA-256 over the DER key, a-p. */
export function extensionIdFromPublicKey(derPublicKey) {
  const hash = createHash('sha256').update(derPublicKey).digest('hex');
  const half = hash.slice(0, 32);
  return [...half].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

export function main() {
  if (existsSync(pemPath)) {
    console.error('[identity] keys/local-notes-web-archive.pem already exists — refusing to rotate.');
    console.error('[identity] Delete it deliberately (ID will change!) if you really mean to.');
    process.exit(1);
  }
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const keyField = spki.toString('base64');
  const extensionId = extensionIdFromPublicKey(spki);

  mkdirSync(join(root, 'keys'), { recursive: true });
  writeFileSync(pemPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));

  let manifest = {};
  if (existsSync(manifestPath)) {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  }
  manifest['key'] = keyField;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`[identity] private key: keys/local-notes-web-archive.pem (never commit)`);
  console.log(`[identity] manifest "key" written; pinned extension ID: ${extensionId}`);
}

main();
