const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

const FROM = `"Marketplace" <${process.env.GMAIL_USER}>`;
const REPLY_TO = process.env.GMAIL_USER;
const FONT = 'Arial,Helvetica,sans-serif';

function wrap(headerText, bodyHtml, footerText) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:${FONT}">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;background:#f5f5f5">
<tr><td style="padding:20px 8px" align="center">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;max-width:560px">
  <tr>
    <td style="background:#4a90d9;border-radius:8px 8px 0 0;padding:22px 24px">
      <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.2;font-family:${FONT}">${headerText}</p>
    </td>
  </tr>
  <tr>
    <td style="background:#ffffff;padding:24px 24px 8px">
      ${bodyHtml}
    </td>
  </tr>
  <tr>
    <td style="background:#f9f9f9;border-top:1px solid #eeeeee;border-radius:0 0 8px 8px;padding:14px 24px;font-size:12px;color:#999999;text-align:center;font-family:${FONT}">
      ${footerText || 'Thank you for your order!'}
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function itemRows(items) {
  return items
    .map(item => {
      const qty = item.quantity || 1;
      return `<tr><td style="padding:8px;border-bottom:1px solid #eee">${item.name} × ${qty}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">₹${(Number(item.price) * qty).toFixed(2)}</td></tr>`;
    })
    .join('');
}

async function sendOrderConfirmation(customerEmail, order) {
  const itemsHtml = itemRows(order.items);

  const bodyHtml = `
<p style="margin:0 0 16px 0;font-size:14px;color:#333">Order ID: <strong>${order.order_id}</strong></p>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">
  <tr style="background:#f9f9f9;font-weight:600">
    <td style="padding:8px">Item</td>
    <td style="padding:8px;text-align:right">Price</td>
  </tr>
  ${itemsHtml}
  <tr style="font-weight:600;border-top:2px solid #4a90d9">
    <td style="padding:12px">Total</td>
    <td style="padding:12px;text-align:right">₹${order.total}</td>
  </tr>
</table>
<p style="margin:16px 0 0 0;font-size:13px;color:#666">Status: <strong>${order.status || 'Confirmed'}</strong></p>
  `;

  await transporter.sendMail({
    from: FROM,
    replyTo: REPLY_TO,
    to: customerEmail,
    subject: `Order Confirmed: ${order.order_id}`,
    html: wrap('Order Confirmed', bodyHtml)
  });
}

async function sendVendorNotification(vendorEmail, order, vendorName) {
  const itemsHtml = itemRows(order.items);

  const bodyHtml = `
<p style="margin:0 0 16px 0;font-size:14px;color:#333">New order received!</p>
<p style="margin:0 0 16px 0;font-size:14px;color:#333">Order ID: <strong>${order.order_id}</strong></p>
<p style="margin:0 0 16px 0;font-size:14px;color:#333">Customer: <strong>${order.customer_name}</strong> | ${order.customer_phone}</p>
<p style="margin:0 0 16px 0;font-size:14px;color:#333">Delivery Address: ${order.delivery_address}</p>
<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:16px 0">
  <tr style="background:#f9f9f9;font-weight:600">
    <td style="padding:8px">Item</td>
    <td style="padding:8px;text-align:right">Price</td>
  </tr>
  ${itemsHtml}
  <tr style="font-weight:600;border-top:2px solid #4a90d9">
    <td style="padding:12px">Total</td>
    <td style="padding:12px;text-align:right">₹${order.total}</td>
  </tr>
</table>
  `;

  await transporter.sendMail({
    from: FROM,
    replyTo: REPLY_TO,
    to: vendorEmail,
    subject: `New Order: ${order.order_id}`,
    html: wrap(`New Order - ${vendorName}`, bodyHtml)
  });
}

const STATUS_LINES = {
  confirmed: 'Your order has been confirmed by the shop and will be prepared soon.',
  ready: 'Your order is out for delivery and on its way to you!',
  delivered: 'Your order has been delivered. Enjoy!',
  cancelled: 'Your order has been cancelled. Any reserved items have been released.'
};

async function sendStatusUpdate(customerEmail, orderId, status) {
  const line = STATUS_LINES[status];
  if (!line || !customerEmail) return;

  const bodyHtml = `
<p style="margin:0 0 12px 0;font-size:14px;color:#333">Order ID: <strong>${orderId}</strong></p>
<p style="margin:0 0 16px 0;font-size:14px;color:#333">${line}</p>
<p style="margin:0 0 8px 0;font-size:13px;color:#666">Track anytime: <a href="${process.env.APP_URL || ''}/track.html" style="color:#4a90d9">${(process.env.APP_URL || '').replace('https://','')}/track</a></p>
  `;

  await transporter.sendMail({
    from: FROM,
    replyTo: REPLY_TO,
    to: customerEmail,
    subject: `Order ${orderId}: ${status.charAt(0).toUpperCase() + status.slice(1)}`,
    html: wrap('Order Update', bodyHtml)
  });
}

async function sendLoginOtp(to, otp) {
  const bodyHtml = `
<p style="margin:0 0 12px 0;font-size:14px;color:#333">Your RajkotMarket login code is:</p>
<p style="margin:0 0 16px 0;font-size:32px;font-weight:700;letter-spacing:6px;color:#e85d04">${otp}</p>
<p style="margin:0;font-size:13px;color:#666">Valid for 15 minutes. Never share this code with anyone.</p>`;
  await transporter.sendMail({
    from: FROM, replyTo: REPLY_TO, to,
    subject: `${otp} is your RajkotMarket login code`,
    html: wrap('Login Code', bodyHtml)
  });
}

async function sendDeliveryOtp(to, orderId, otp) {
  const bodyHtml = `
<p style="margin:0 0 12px 0;font-size:14px;color:#333">Your order <strong>${orderId}</strong> is out for delivery!</p>
<p style="margin:0 0 8px 0;font-size:14px;color:#333">Give this code to the delivery person to receive your order:</p>
<p style="margin:0 0 16px 0;font-size:32px;font-weight:700;letter-spacing:6px;color:#e85d04">${otp}</p>
<p style="margin:0;font-size:13px;color:#666">Share it ONLY when your order is in your hands.</p>`;
  await transporter.sendMail({
    from: FROM, replyTo: REPLY_TO, to,
    subject: `Delivery code for ${orderId}`,
    html: wrap('Out for Delivery', bodyHtml)
  });
}

async function sendComplaintAlert(complaint) {
  await transporter.sendMail({
    from: FROM, replyTo: complaint.email, to: process.env.GMAIL_USER,
    subject: `[Complaint] ${complaint.subject} — ${complaint.order_id}`,
    html: wrap('New Complaint', `
<p style="font-size:14px;color:#333;margin:0 0 8px">Order: <b>${complaint.order_id}</b></p>
${complaint.product_name ? `<p style="font-size:14px;color:#333;margin:0 0 8px">Item: <b>${complaint.product_name}</b></p>` : ''}
<p style="font-size:14px;color:#333;margin:0 0 8px">From: ${complaint.customer_name} (${complaint.email}${complaint.phone ? ', ' + complaint.phone : ''})</p>
<p style="font-size:14px;color:#333;margin:0 0 8px"><b>${complaint.subject}</b></p>
<p style="font-size:13px;color:#555;margin:0">${complaint.description}</p>`)
  });
}

// Sent to the customer when the admin records a resolution for their complaint.
async function sendComplaintResolution(to, complaint, resolution) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const titleCase = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());
  await transporter.sendMail({
    from: FROM, replyTo: REPLY_TO, to,
    subject: `Re: ${complaint.subject} — order ${complaint.order_id} (Resolved)`,
    html: wrap('Your complaint has been resolved', `
<p style="font-size:14px;color:#333;margin:0 0 12px;font-family:${FONT}">Hi ${esc(titleCase(complaint.customer_name)) || 'there'},</p>
<p style="font-size:14px;color:#333;margin:0 0 14px;font-family:${FONT}">Here's the update on the issue you raised for order <b>${esc(complaint.order_id)}</b>:</p>
<p style="font-size:12px;color:#888;margin:0 0 4px;font-family:${FONT}">YOUR COMPLAINT</p>
<p style="font-size:14px;color:#333;margin:0 0 14px;font-family:${FONT}"><b>${esc(complaint.subject)}</b><br>${esc(complaint.description)}</p>
<p style="font-size:12px;color:#888;margin:0 0 4px;font-family:${FONT}">OUR RESOLUTION</p>
<p style="font-size:14px;color:#333;margin:0 0 16px;font-family:${FONT};white-space:pre-wrap">${esc(resolution)}</p>
<p style="font-size:13px;color:#555;margin:0;font-family:${FONT}">If anything still isn't right, just reply to this email and we'll help.</p>`,
      'RajkotMarket — supporting local businesses in Rajkot')
  });
}

// Sent to the customer when the admin posts a reply on their open complaint
// thread (an ongoing message, not the final resolution).
async function sendComplaintReply(to, complaint, message) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const titleCase = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());
  await transporter.sendMail({
    from: FROM, replyTo: REPLY_TO, to,
    subject: `Re: ${complaint.subject} — order ${complaint.order_id}`,
    html: wrap('We replied to your complaint', `
<p style="font-size:14px;color:#333;margin:0 0 12px;font-family:${FONT}">Hi ${esc(titleCase(complaint.customer_name)) || 'there'},</p>
<p style="font-size:14px;color:#333;margin:0 0 14px;font-family:${FONT}">We've posted an update on the issue you raised for order <b>${esc(complaint.order_id)}</b>:</p>
<p style="font-size:12px;color:#888;margin:0 0 4px;font-family:${FONT}">OUR MESSAGE</p>
<p style="font-size:14px;color:#333;margin:0 0 16px;font-family:${FONT};white-space:pre-wrap">${esc(message)}</p>
<p style="font-size:13px;color:#555;margin:0;font-family:${FONT}">Open <b>My Orders</b> on RajkotMarket to read the full conversation and reply.</p>`,
      'RajkotMarket — supporting local businesses in Rajkot')
  });
}

// Sent to the customer as their return request moves through the pipeline.
async function sendReturnUpdate(to, ret) {
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const titleCase = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase());
  const COPY = {
    Requested: 'We\'ve received your return request and our team will review it shortly.',
    Approved: 'Good news — your return has been <b>approved</b>. We\'ll arrange a pickup of the item soon.',
    Rejected: 'After review, your return request could <b>not be approved</b>.',
    'Picked up': 'We\'ve <b>received the returned item</b>. Your refund will be processed next.',
    Refunded: 'Your <b>refund has been processed</b>.'
  };
  const extra = [];
  if (ret.admin_note) {
    extra.push(`<p style="font-size:12px;color:#888;margin:14px 0 4px;font-family:${FONT}">NOTE FROM OUR TEAM</p>
<p style="font-size:14px;color:#333;margin:0;font-family:${FONT};white-space:pre-wrap">${esc(ret.admin_note)}</p>`);
  }
  if (ret.status === 'Refunded' && ret.refund_amount != null && ret.refund_amount !== '') {
    extra.push(`<p style="font-size:14px;color:#333;margin:14px 0 0;font-family:${FONT}">Refund: <b>&#8377;${Number(ret.refund_amount).toLocaleString('en-IN')}</b>${ret.refund_method ? ' via ' + esc(ret.refund_method) : ''}</p>`);
  }
  await transporter.sendMail({
    from: FROM, replyTo: REPLY_TO, to,
    subject: `Return update — order ${ret.order_id} (${ret.status})`,
    html: wrap('Return ' + ret.status, `
<p style="font-size:14px;color:#333;margin:0 0 12px;font-family:${FONT}">Hi ${esc(titleCase(ret.customer_name)) || 'there'},</p>
<p style="font-size:14px;color:#333;margin:0 0 14px;font-family:${FONT}">${COPY[ret.status] || ('Your return status is now ' + esc(ret.status) + '.')}</p>
<p style="font-size:13px;color:#555;margin:0;font-family:${FONT}">Order: <b>${esc(ret.order_id)}</b></p>
${extra.join('')}
<p style="font-size:13px;color:#555;margin:14px 0 0;font-family:${FONT}">Questions? Just reply to this email.</p>`,
      'RajkotMarket — supporting local businesses in Rajkot')
  });
}

module.exports = {
  sendOrderConfirmation,
  sendVendorNotification,
  sendStatusUpdate,
  sendLoginOtp,
  sendDeliveryOtp,
  sendComplaintAlert,
  sendComplaintResolution,
  sendComplaintReply,
  sendReturnUpdate
};
