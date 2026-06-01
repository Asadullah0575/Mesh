// api/upload.js (CommonJS)
const { verifyToken, getToken, cors, ok, err } = require('./_lib');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405);

  const user = await verifyToken(getToken(req));
  if (!user) return err(res, 'Unauthorised', 401);

  const { image } = req.body || {};
  if (!image) return err(res, 'image required');
  if (!image.startsWith('data:image/')) return err(res, 'Invalid image format');
  if (image.length > 1500000) return err(res, 'Image too large. Max 1MB.');

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey    = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) return err(res, 'Cloudinary not configured', 500);

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const folder    = 'mesh';
    const publicId  = 'avatars/' + user.sub;

    // Must match EXACTLY what Cloudinary expects - alphabetical order
    const params = {
      folder:    folder,
      overwrite: 'true',
      public_id: publicId,
      timestamp: String(timestamp),
    };

    // Signature string: sorted alphabetically, joined by &, then append secret
    const sigStr = Object.keys(params)
      .sort()
      .map(k => k + '=' + params[k])
      .join('&') + apiSecret;

    const signature = crypto.createHash('sha1').update(sigStr).digest('hex');

    const body = new URLSearchParams();
    body.append('file',      image);
    body.append('api_key',   apiKey);
    body.append('timestamp', String(timestamp));
    body.append('signature', signature);
    body.append('folder',    folder);
    body.append('public_id', publicId);
    body.append('overwrite', 'true');

    const response = await fetch(
      'https://api.cloudinary.com/v1_1/' + cloudName + '/image/upload',
      { method: 'POST', body }
    );

    const data = await response.json();
    if (data.error) return err(res, 'Upload failed: ' + data.error.message, 400);
    return ok(res, { url: data.secure_url });
  } catch (e) {
    return err(res, e.message, 500);
  }
};