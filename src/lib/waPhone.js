// src/lib/waPhone.js
// Normalises SA phone numbers and opens WhatsApp directly to that number
// instead of dumping the user into the contact picker.

var DEFAULT_COUNTRY = "27"; // South Africa

/**
 * Turn whatever is stored on the member record into a wa.me-safe MSISDN.
 * Returns null if the number can't be trusted.
 *
 * 082 123 4567    -> 27821234567
 * 0821234567      -> 27821234567
 * +27 82 123 4567 -> 27821234567
 * 27821234567     -> 27821234567
 * 821234567       -> 27821234567
 */
export function normaliseWaNumber(raw) {
  if (!raw) return null;

  var digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  // Strip a leading 00 international prefix (0027... )
  if (digits.slice(0, 2) === "00") digits = digits.slice(2);

  // Already international SA: 27 + 9 digits
  if (digits.slice(0, 2) === DEFAULT_COUNTRY && digits.length === 11) {
    return digits;
  }

  // Local format: 0 + 9 digits
  if (digits.charAt(0) === "0" && digits.length === 10) {
    return DEFAULT_COUNTRY + digits.slice(1);
  }

  // Bare subscriber number: 9 digits starting 6/7/8
  if (digits.length === 9 && /^[678]/.test(digits)) {
    return DEFAULT_COUNTRY + digits;
  }

  // Some other country already in full international form
  if (digits.length >= 11 && digits.length <= 15) {
    return digits;
  }

  return null;
}

/**
 * Strip replacement characters / lone surrogates that break the WhatsApp
 * URL preview, and normalise line endings.
 */
export function sanitiseWaText(text) {
  return String(text || "")
    .replace(/\uFFFD/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1")
    .replace(/\r\n/g, "\n")
    .trim();
}

/**
 * Open WhatsApp with the message pre-filled.
 * If a valid number is supplied it goes STRAIGHT to that chat.
 * If not, it falls back to the share sheet (contact picker).
 */
export function openWhatsApp(text, phone) {
  var body = encodeURIComponent(sanitiseWaText(text));
  var msisdn = normaliseWaNumber(phone);

  var url = msisdn
    ? "https://wa.me/" + msisdn + "?text=" + body
    : "https://api.whatsapp.com/send?text=" + body;

  window.open(url, "_blank", "noopener,noreferrer");
  return !!msisdn;
}

/**
 * Pull a usable number off a member record, whatever shape it arrives in.
 */
export function memberWaNumber(member) {
  if (!member) return null;
  var candidates = [
    member.phone,
    member.whatsapp,
    member.cell,
    member.cell_number,
    member.mobile,
    member.contact_number,
    member.phone_number,
  ];
  for (var i = 0; i < candidates.length; i++) {
    var n = normaliseWaNumber(candidates[i]);
    if (n) return n;
  }
  return null;
}

export default openWhatsApp;
