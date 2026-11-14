function getPublicBaseUrl(env = process.env) {
  const value = env.PUBLIC_BASE_URL;
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash ||
      (env.NODE_ENV === 'production' && url.protocol !== 'https:')) {
    throw new Error('PUBLIC_BASE_URL must be an origin without credentials, path, query or fragment; production requires HTTPS');
  }
  return url.origin;
}

module.exports = { getPublicBaseUrl };
