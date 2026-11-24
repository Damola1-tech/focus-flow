// Makes the two keys phone alerts need. Run:  node supabase/make-vapid-keys.mjs
import { generateKeyPairSync, randomBytes } from 'node:crypto';
const b64u = (b) => Buffer.from(b).toString('base64url');
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' }), prv = privateKey.export({ format: 'jwk' });
const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
console.log('VAPID_PUBLIC_KEY  (goes in config.js AND in Supabase secrets):\n' + b64u(raw) + '\n');
console.log('VAPID_PRIVATE_KEY (goes ONLY in Supabase secrets, keep it private):\n' + prv.d + '\n');
console.log('CRON_SECRET (goes in Supabase secrets AND in cron.sql):\n' + b64u(randomBytes(24)) + '\n');
