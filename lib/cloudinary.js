// Cloudinary helper — signed direct uploads + asset deletion.
//
// QC photos upload straight from the partner's browser to Cloudinary (so the
// bytes never pass through our Serverless Function / Vercel body limit). The
// server only SIGNS the upload params; the secret never leaves the backend.
// On case close (Phase 3) the live asset is destroyed after it's archived to
// Drive.
//
// Env (set in Vercel): CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
// CLOUDINARY_API_SECRET. If any is missing we throw a clear, catchable error.

const crypto = require('crypto');

function creds() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Photo uploads are not configured yet (missing Cloudinary keys).');
  }
  return { cloudName, apiKey, apiSecret };
}

function isConfigured() {
  return !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

// Cloudinary signature = sha1(sorted "k=v&k=v" of the signed params + secret).
function sign(params, apiSecret) {
  const toSign = Object.keys(params).sort()
    .map(k => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}

// Params the browser must echo back verbatim alongside the file.
function signUpload(folder) {
  const { cloudName, apiKey, apiSecret } = creds();
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = { folder, timestamp };
  const signature = sign(signed, apiSecret);
  return {
    cloudName, apiKey, timestamp, folder, signature,
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`
  };
}

// Delete one asset by its public_id (used by the archive-on-close step).
async function destroy(publicId) {
  const { cloudName, apiKey, apiSecret } = creds();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = sign({ public_id: publicId, timestamp }, apiSecret);
  const body = new URLSearchParams({ public_id: publicId, api_key: apiKey, timestamp: String(timestamp), signature });
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, {
    method: 'POST', body
  });
  const data = await res.json().catch(() => ({}));
  return data; // { result: 'ok' | 'not found' }
}

module.exports = { signUpload, destroy, isConfigured };
