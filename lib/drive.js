// Google Drive upload helper for the nightly order-archive job (api/cleanup).
//
// Uses an OAuth *refresh token* for the archive Google account to mint a
// short-lived access token, then uploads a file via the Drive v3 multipart
// endpoint. No SDK — plain fetch (Node 18+, so fine on Vercel).
//
// Required env (set in Vercel, for the account that should OWN the backups):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//   GDRIVE_ARCHIVE_FOLDER_ID   (optional — omit to drop files in My Drive root)

async function getAccessToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Google Drive credentials are not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN).');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });

  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Google token exchange returned no access_token.');
  return json.access_token;
}

// Uploads a UTF-8 JSON string as a file to Drive.
// Returns { id, name, webViewLink }.
async function uploadJsonFile(filename, jsonString) {
  const token = await getAccessToken();
  const folderId = process.env.GDRIVE_ARCHIVE_FOLDER_ID;

  const metadata = {
    name: filename,
    mimeType: 'application/json',
    ...(folderId ? { parents: [folderId] } : {})
  };

  const boundary = 'rajkotmarket-' + Date.now();
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    jsonString + '\r\n' +
    `--${boundary}--`;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (!res.ok) throw new Error(`Drive upload failed (${res.status}): ${await res.text()}`);
  return res.json();
}

// Uploads arbitrary binary (a Buffer) to Drive, base64-encoded in the multipart
// body. opts.shareAnyone = true makes it viewable by anyone with the link (used
// for refund receipts so admin/customer can open the proof). Returns
// { id, name, webViewLink }.
async function uploadBinaryFile(filename, mimeType, buffer, opts = {}) {
  const token = await getAccessToken();
  const folderId = process.env.GDRIVE_ARCHIVE_FOLDER_ID;

  const metadata = {
    name: filename,
    ...(folderId ? { parents: [folderId] } : {})
  };

  const boundary = 'rajkotmarket-' + Date.now();
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    `--${boundary}\r\n` +
    `Content-Type: ${mimeType}\r\n` +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    Buffer.from(buffer).toString('base64') + '\r\n' +
    `--${boundary}--`;

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body
    }
  );

  if (!res.ok) throw new Error(`Drive binary upload failed (${res.status}): ${await res.text()}`);
  const file = await res.json();

  // Make the file readable by anyone with the link (best-effort).
  if (opts.shareAnyone && file.id) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/permissions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    }).catch(() => {});
  }
  return file;
}

// Downloads a Drive file's bytes by id. Returns { buffer, contentType }.
// Used by the admin recordings UI to stream private audio back through our own
// authenticated endpoint (the files are not public).
async function downloadFile(fileId) {
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Drive download failed (${res.status}): ${await res.text()}`);
  const contentType = res.headers.get('content-type') || 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

// Permanently deletes a Drive file by id (used by the retention purge for
// expired call recordings). Best-effort: resolves even if the file is already
// gone. Returns true on a successful/!found delete.
async function deleteFile(fileId) {
  if (!fileId) return false;
  const token = await getAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok || res.status === 404;
}

module.exports = { uploadJsonFile, uploadBinaryFile, downloadFile, deleteFile };
