/**
 * documentProcessor.js — Document text splitting utility.
 * Lightweight, zero-dependency JavaScript implementation of RecursiveCharacterTextSplitter.
 */
const { v4: uuidv4 } = require('uuid');

class RecursiveCharacterTextSplitter {
  constructor({ chunkSize = 1000, chunkOverlap = 200, separators = ["\n\n", "\n", ". ", " ", ""] } = {}) {
    this.chunkSize = chunkSize;
    this.chunkOverlap = chunkOverlap;
    this.separators = separators;
  }

  splitText(text) {
    if (!text) return [];
    const chunks = [];
    let start = 0;

    while (start < text.length) {
      let end = start + this.chunkSize;
      if (end >= text.length) {
        chunks.push(text.slice(start));
        break;
      }

      let bestCut = end;
      for (const sep of this.separators) {
        const searchStart = Math.max(start, end - this.chunkOverlap);
        const idx = text.lastIndexOf(sep, end);
        if (idx !== -1 && idx >= searchStart) {
          bestCut = idx + sep.length;
          break;
        }
      }

      chunks.push(text.slice(start, bestCut));
      start = bestCut - this.chunkOverlap;
      if (start >= text.length) {
        break;
      }
    }
    return chunks.map(c => c.trim()).filter(Boolean);
  }
}

module.exports = {
  RecursiveCharacterTextSplitter
};
