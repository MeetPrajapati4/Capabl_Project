/**
 * sanitizer.js — Centralized content sanitization for all text sent to NVIDIA API.
 */

const IMAGE_PATTERNS = [
  /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/gi,
  /data:image\/[a-zA-Z]+;base64,/gi,
  /\[Image file:.*?\]/gi,
  /\[image\]/gi,
  /image\.(?:png|jpg|jpeg|gif|bmp|webp|svg|ico|tiff?)/gi,
  /\bbase64\b/gi,
  /data:image/gi
];

const NON_PRINTABLE_RE = /[^\x20-\x7E\x0A\x0D\u0080-\uFFFF]/g;

function sanitizeText(text) {
  if (typeof text !== 'string') {
    text = String(text);
  }

  let cleaned = text.replace(NON_PRINTABLE_RE, '');
  for (const pattern of IMAGE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  if (cleaned.length > 32000) {
    cleaned = cleaned.slice(0, 32000);
  }

  return cleaned.trim();
}

function sanitizeDocument(docText, filename = "") {
  const text = sanitizeText(docText);
  if (text.length < 20) {
    return `[The file '${filename}' contains visual content that cannot be processed as text.]`;
  }
  if (text && text.length > 50) {
    const alphaCount = [...text].filter(c => /[a-zA-Z]/.test(c)).length;
    const alphaRatio = alphaCount / Math.max(text.length, 1);
    if (alphaRatio < 0.3) {
      return `[The file '${filename}' appears to be an image or binary file.]`;
    }
  }
  return text;
}

module.exports = {
  sanitizeText,
  sanitizeDocument
};
