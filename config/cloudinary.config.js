const dns = require('dns');
const cloudinary = require('cloudinary').v2;
const path = require('path');

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const FOLDER = process.env.CLOUDINARY_FOLDER || 'taskflow_uploads';

const isCloudinaryEnabled = (env = process.env) => {
  if (env.CLOUDINARY_ENABLED === 'false') return false;
  if (env.NODE_ENV === 'test' && env.CLOUDINARY_ENABLED !== 'true') return false;
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_SECRET
  );
};

const configureCloudinary = (env = process.env) => {
  if (!isCloudinaryEnabled(env)) return false;
  cloudinary.config({
    cloud_name: String(env.CLOUDINARY_CLOUD_NAME).trim().toLowerCase(),
    api_key: String(env.CLOUDINARY_API_KEY).trim(),
    api_secret: String(env.CLOUDINARY_API_SECRET).trim(),
    secure: true,
  });
  return true;
};

const getAssetMetadata = (filename = '') => {
  const ext = path.extname(filename).toLowerCase();
  const isImage = IMAGE_EXTENSIONS.has(ext);
  const resourceType = isImage ? 'image' : 'raw';
  const assetId = isImage ? filename.slice(0, -ext.length) : filename;
  const format = isImage ? ext.slice(1) : undefined;
  return {
    resourceType,
    assetId,
    publicId: `${FOLDER}/${assetId}`,
    format,
  };
};

const uploadToCloudinary = async (localFilePath, filename) => {
  configureCloudinary();
  const { resourceType, assetId } = getAssetMetadata(filename);
  return cloudinary.uploader.upload(localFilePath, {
    folder: FOLDER,
    public_id: assetId,
    resource_type: resourceType,
    use_filename: false,
    unique_filename: false,
    overwrite: true,
  });
};

const getCloudinarySignedUrl = (filename) => {
  configureCloudinary();
  const { resourceType, publicId, format } = getAssetMetadata(filename);
  const options = {
    resource_type: resourceType,
    secure: true,
    sign_url: true,
  };
  if (format) options.format = format;
  return cloudinary.url(publicId, options);
};

const deleteFromCloudinary = async (filename) => {
  if (!isCloudinaryEnabled()) return false;
  configureCloudinary();
  const { resourceType, publicId } = getAssetMetadata(filename);
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    invalidate: true,
  });
  return result?.result === 'ok' || result?.result === 'not found';
};

module.exports = {
  isCloudinaryEnabled,
  configureCloudinary,
  getAssetMetadata,
  uploadToCloudinary,
  getCloudinarySignedUrl,
  deleteFromCloudinary,
};

