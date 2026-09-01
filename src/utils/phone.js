/**
 * Normalizes phone numbers to standard WhatsApp format (e.g. 628xxx)
 * @param {string|number} rawNumber
 * @returns {string} Clean digits formatted for WhatsApp
 */
function normalizePhoneNumber(rawNumber) {
  if (!rawNumber) return "";
  let cleaned = String(rawNumber).replace(/\D/g, "");

  if (cleaned.startsWith("08")) {
    cleaned = "62" + cleaned.slice(1);
  } else if (cleaned.startsWith("8") && cleaned.length >= 9 && cleaned.length <= 13) {
    cleaned = "62" + cleaned;
  } else if (cleaned.startsWith("6208")) {
    cleaned = "628" + cleaned.slice(4);
  }

  return cleaned;
}

module.exports = { normalizePhoneNumber };
