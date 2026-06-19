// Archive-on-close for return QC photos.
//
// When a return reaches a terminal state (Refunded / Exchanged / Rejected /
// QC failed) the live Cloudinary photos are: (1) copied into the Google Drive
// archive folder, then (2) deleted from Cloudinary, and (3) the return_photos
// rows are stamped archived_at. The return row is flagged archived.
//
// Everything is BEST-EFFORT and idempotent: a Drive/Cloudinary hiccup must not
// block closing a return. A photo is only destroyed on Cloudinary AFTER its
// bytes are safely on Drive, so a failure mid-run never loses an un-archived
// image.

const supabase = require('./supabase');
const drive = require('./drive');
const cloudinary = require('./cloudinary');

async function archiveReturnPhotos(orderId) {
  if (!orderId) return { archived: 0 };
  const { data: photos } = await supabase
    .from('return_photos').select('*').eq('order_id', orderId).is('archived_at', null);
  if (!photos || !photos.length) {
    await supabase.from('return_requests')
      .update({ archived: true, archived_at: new Date().toISOString() }).eq('order_id', orderId);
    return { archived: 0 };
  }

  let archived = 0;
  for (const p of photos) {
    try {
      // 1. Pull the live bytes from Cloudinary.
      const resp = await fetch(p.url);
      if (!resp.ok) throw new Error(`fetch ${resp.status}`);
      const mime = resp.headers.get('content-type') || 'image/jpeg';
      const ext = (mime.split('/')[1] || 'jpg').split(';')[0];
      const buf = Buffer.from(await resp.arrayBuffer());

      // 2. Park them in Drive (filename encodes order/product/slot).
      const name = `return-${orderId}-${(p.product_id || 'item')}-${p.slot}.${ext}`;
      const up = await drive.uploadBinaryFile(name, mime, buf);

      // 3. Bytes are safe — now delete from Cloudinary (if we have a public_id).
      if (p.public_id && cloudinary.isConfigured()) {
        await cloudinary.destroy(p.public_id).catch(() => {});
      }

      // 4. Stamp the row: keep the Drive link, drop the dead Cloudinary url.
      await supabase.from('return_photos').update({
        url: up.webViewLink || up.id || p.url,
        public_id: null,
        archived_at: new Date().toISOString()
      }).eq('id', p.id);
      archived++;
    } catch (e) {
      console.error('return photo archive failed', p.id, e.message);
      // leave this row un-archived so a later run retries it
    }
  }

  // Flag the return archived only when every photo made it across.
  if (archived === photos.length) {
    await supabase.from('return_requests')
      .update({ archived: true, archived_at: new Date().toISOString() }).eq('order_id', orderId);
  }
  return { archived, total: photos.length };
}

module.exports = { archiveReturnPhotos };
