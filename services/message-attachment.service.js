const { resolveFileAccess, validFilename } = require('./file-access.service');
const invalid = () => { throw Object.assign(new Error('Not authorized to attach this file'), { statusCode: 400, public: true }); };

async function validateMessageAttachments(attachments = [], user) {
  if (!Array.isArray(attachments) || attachments.length > 5) invalid();
  const result = [];
  for (const item of attachments) {
    if (!item || typeof item.url !== 'string' || typeof item.name !== 'string' || typeof item.type !== 'string' ||
      item.name.length > 255 || item.type.length > 100 || item.url.length > 2048) invalid();
    let url;
    try { url = new URL(item.url, 'http://local.invalid'); } catch { invalid(); }
    if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.startsWith('/uploads/') || url.search || url.hash) invalid();
    const filename = url.pathname.slice('/uploads/'.length);
    if (!validFilename(filename) || !await resolveFileAccess(filename, user)) invalid();
    result.push({ name: item.name, url: `/uploads/${filename}`, type: item.type });
  }
  return result;
}
async function validateTaskAttachments(attachments = [], user) {
  if (!Array.isArray(attachments) || attachments.length > 5) invalid();
  const result = [];
  for (const item of attachments) {
    if (!item || !validFilename(item.filename) || typeof item.name !== 'string' || item.name.length > 255 ||
      typeof item.type !== 'string' || item.type.length > 100 || !await resolveFileAccess(item.filename, user)) invalid();
    result.push({ filename: item.filename, name: item.name, type: item.type, url: `/uploads/${item.filename}` });
  }
  return result;
}
module.exports = { validateMessageAttachments, validateTaskAttachments };
