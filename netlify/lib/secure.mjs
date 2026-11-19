// AES-256-GCM for secrets at rest (the Apple app-specific password). Key comes from AGENDA_SECRET.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const key = () => {
  const s = process.env.AGENDA_SECRET;
  if (!s || s.length < 16) throw new Error('AGENDA_SECRET is missing in Netlify environment variables (see README).');
  return createHash('sha256').update(s).digest();
};
export function seal(text) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function unseal(b64) {
  const buf = Buffer.from(b64, 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
