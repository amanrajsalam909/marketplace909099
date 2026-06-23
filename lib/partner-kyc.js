// Partner KYC / verification helpers, shared by api/admin.js (delivery
// partners), api/feedback.js (pickup partners) and api/delivery.js (allocation
// gate). The whole record lives in <partner>.compliance JSONB — mirrors the
// vendor compliance model (api/admin.js sanitizeCompliance), but with the
// document set delivery/pickup partners actually need.

const KYC_STATUSES = ['Pending', 'Submitted', 'Verified', 'Rejected', 'N/A'];
const AGREEMENT_STATUSES = ['Pending', 'Active', 'Expired', 'Terminated'];
// Driving Licence, Vehicle Ownership proof, Vehicle RC book, Aadhaar card.
const PARTNER_DOC_KEYS = ['aadhaar', 'license', 'vehicle_ownership', 'vehicle_rc'];

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// Whitelist + length/enum-bound an incoming compliance object before storing.
function sanitizePartnerCompliance(a) {
  a = a || {};
  const ag = a.agreement || {}, bank = a.bank || {}, mob = a.mobile || {}, docs = a.documents || {};
  const out = { agreement: {}, mobile: {}, bank: {}, documents: {} };

  // Customer relationship agreement.
  out.agreement = {
    status: AGREEMENT_STATUSES.includes(ag.status) ? ag.status : 'Pending',
    signed_on: clip(ag.signed_on, 20),
    notes: clip(ag.notes, 2000)
  };

  // Personal mobile number.
  out.mobile = {
    number: clip(mob.number, 20).replace(/\D/g, '').slice(-15),
    status: KYC_STATUSES.includes(mob.status) ? mob.status : 'Pending',
    note: clip(mob.note, 500)
  };

  // Bank account (for payouts).
  out.bank = {
    holder: clip(bank.holder, 120),
    account_number: clip(bank.account_number, 34).replace(/\s+/g, ''),
    ifsc: clip(bank.ifsc, 15).toUpperCase(),
    bank_name: clip(bank.bank_name, 120),
    status: KYC_STATUSES.includes(bank.status) ? bank.status : 'Pending',
    note: clip(bank.note, 500)
  };

  // Identity / vehicle documents.
  for (const k of PARTNER_DOC_KEYS) {
    const d = docs[k] || {};
    out.documents[k] = {
      number: clip(d.number, 80),
      status: KYC_STATUSES.includes(d.status) ? d.status : 'Pending',
      url: clip(d.url, 500),
      note: clip(d.note, 500)
    };
  }

  return out;
}

// A partner is VERIFIED when the agreement is Active and every KYC item is
// Verified. 'N/A' counts as satisfied so an admin can waive an item that does
// not apply (e.g. vehicle docs for a partner who doesn't use a vehicle).
function isPartnerVerified(compliance) {
  const c = compliance || {};
  const ok = s => s === 'Verified' || s === 'N/A';
  if ((c.agreement || {}).status !== 'Active') return false;
  if (!ok((c.mobile || {}).status)) return false;
  if (!ok((c.bank || {}).status)) return false;
  const docs = c.documents || {};
  for (const k of PARTNER_DOC_KEYS) {
    if (!ok((docs[k] || {}).status)) return false;
  }
  return true;
}

module.exports = {
  sanitizePartnerCompliance, isPartnerVerified,
  PARTNER_DOC_KEYS, KYC_STATUSES, AGREEMENT_STATUSES
};
