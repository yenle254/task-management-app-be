const fs = require('fs/promises');
const path = require('path');
const MIME_TYPES = Object.freeze({
  pdf: 'application/pdf', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', txt: 'text/plain', zip: 'application/zip', rar: 'application/vnd.rar',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
});
const extension = name => path.extname(name || '').slice(1).toLowerCase();
const allowedExtension = name => Object.hasOwn(MIME_TYPES, extension(name));

function matchesSignature(bytes, ext) {
  const hex = prefix => bytes.subarray(0, prefix.length / 2).equals(Buffer.from(prefix, 'hex'));
  switch (ext) {
    case 'png': return hex('89504e470d0a1a0a');
    case 'jpg': case 'jpeg': return hex('ffd8ff');
    case 'gif': return ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString());
    case 'pdf': return bytes.subarray(0, 5).toString() === '%PDF-';
    case 'webp': return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    case 'zip': case 'docx': case 'xlsx': case 'pptx': return hex('504b0304') || hex('504b0506') || hex('504b0708');
    case 'doc': case 'xls': case 'ppt': return hex('d0cf11e0a1b11ae1');
    case 'rar': return hex('526172211a0700') || hex('526172211a070100');
    case 'txt': case 'csv': return !bytes.includes(0); // Served as downloads, never HTML.
    default: return false;
  }
}

async function inspectFile(filePath, name) {
  const handle = await fs.open(filePath, 'r');
  try {
    const bytes = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const ext = extension(name);
    return matchesSignature(bytes.subarray(0, bytesRead), ext) ? MIME_TYPES[ext] : null;
  } finally { await handle.close(); }
}
module.exports = { MIME_TYPES, extension, allowedExtension, matchesSignature, inspectFile };
