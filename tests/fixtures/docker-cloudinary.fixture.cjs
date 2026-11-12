// Mounted read-only by docker-smoke.cjs, never copied into the production image.
// Exercise the real upload middleware and filesystem without cloud credentials.
const fs = require('node:fs');
const cloudinary = require('/app/node_modules/cloudinary').v2;
cloudinary.uploader.upload = async file => {
  const content = fs.readFileSync(file, 'utf8');
  if (content === 'simulate-cloud-failure') throw new Error('Simulated Cloudinary failure');
  if (content !== 'Docker upload smoke test') throw new Error('Unexpected upload bytes');
  return { public_id: 'smoke-test' };
};
cloudinary.uploader.destroy = async () => ({ result: 'ok' });
