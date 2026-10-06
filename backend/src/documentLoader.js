/**
 * documentLoader.js — Document Extraction and Classification Pipeline
 * 
 * Supports PDF, DOCX, PPTX, XLSX, TXT, MD with virtual page pagination.
 */

const fs = require('fs');
const path = require('path');
const officeParser = require('officeparser');
const { RecursiveCharacterTextSplitter } = require('./documentProcessor');
const { sanitizeDocument } = require('./sanitizer');
const { CHUNK_SIZE, CHUNK_OVERLAP } = require('./config');

const DOC_TYPE_PATTERNS = {
  question_paper: [
    /question\s*paper/i,
    /examination/i,
    /marks?\s*:/i,
    /attempt\s+(any|all)/i,
    /max\.?\s*marks/i,
    /time\s*:\s*\d/i,
    /answer\s+(any|all)/i,
    /instructions\s+to\s+candidates/i
  ],
  lab_manual: [
    /experiment\s*no/i,
    /lab\s*(manual|report)/i,
    /apparatus/i,
    /procedure\s*:/i,
    /observation\s*table/i,
    /aim\s*:/i,
    /theory\s*:/i,
    /result\s*:/i
  ],
  notes: [
    /chapter\s*\d/i,
    /unit\s*\d/i,
    /module\s*\d/i,
    /lecture\s*notes/i,
    /summary\s*:/i,
    /key\s*points/i,
    /introduction\s*:/i,
    /definition\s*:/i
  ]
};

function detectDocumentType(text) {
  if (!text) return "general";
  const sample = text.slice(0, 2000).toLowerCase();
  const scores = {};

  for (const [docType, patterns] of Object.entries(DOC_TYPE_PATTERNS)) {
    let score = 0;
    for (const pattern of patterns) {
      if (pattern.test(sample)) {
        score++;
      }
    }
    scores[docType] = score;
  }

  let bestType = "general";
  let maxScore = 1;
  for (const [docType, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestType = docType;
    }
  }

  return bestType;
}

function splitIntoVirtualPages(text) {
  if (!text) return [];
  
  const pages = [];
  const limit = 1500;
  let currentStart = 0;
  let pageNum = 1;

  while (currentStart < text.length) {
    let currentEnd = currentStart + limit;
    if (currentEnd >= text.length) {
      pages.push({
        text: text.slice(currentStart).trim(),
        page: pageNum
      });
      break;
    }

    let bestCut = currentEnd;
    const searchArea = text.slice(Math.max(currentStart, currentEnd - 300), currentEnd);
    const lastDoubleNL = searchArea.lastIndexOf("\n\n");
    const lastSingleNL = searchArea.lastIndexOf("\n");
    const lastSpace = searchArea.lastIndexOf(" ");

    if (lastDoubleNL !== -1) {
      bestCut = Math.max(currentStart, currentEnd - 300) + lastDoubleNL + 2;
    } else if (lastSingleNL !== -1) {
      bestCut = Math.max(currentStart, currentEnd - 300) + lastSingleNL + 1;
    } else if (lastSpace !== -1) {
      bestCut = Math.max(currentStart, currentEnd - 300) + lastSpace + 1;
    }

    pages.push({
      text: text.slice(currentStart, bestCut).trim(),
      page: pageNum
    });
    currentStart = bestCut;
    pageNum++;
  }

  return pages.filter(p => p.text.length > 0);
}

async function extractTextAndPages(fileBytesOrBuffer, filename) {
  const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  let text = "";

  if (ext === "txt" || ext === "md") {
    try {
      text = fileBytesOrBuffer.toString("utf8");
    } catch (err) {
      text = fileBytesOrBuffer.toString("latin1");
    }
  } else {
    try {
      const parsed = await officeParser.parseOffice(fileBytesOrBuffer);
      text = (typeof parsed === "object" && parsed !== null && typeof parsed.toText === "function") 
        ? parsed.toText() 
        : String(parsed || "");
    } catch (err) {
      console.error(`[documentLoader] Error parsing via officeparser for ${filename}:`, err);
      throw err;
    }
  }

  const sanitizedText = sanitizeDocument(text, filename);
  
  let pages = [];
  if (["pdf", "pptx", "ppt", "xlsx", "xls"].includes(ext)) {
    pages = splitIntoVirtualPages(sanitizedText);
  } else {
    pages = [{ text: sanitizedText, page: 1 }];
  }

  if (pages.length === 0 && sanitizedText.trim()) {
    pages = [{ text: sanitizedText, page: 1 }];
  }

  return { text: sanitizedText, pages };
}

async function loadAndChunk(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  
  const { text, pages } = await extractTextAndPages(fileBuffer, filename);
  if (!pages || pages.length === 0) {
    return [];
  }

  const docType = detectDocumentType(text);

  const rawDocuments = [];
  for (const pageData of pages) {
    rawDocuments.push({
      pageContent: pageData.text,
      metadata: {
        source: filename,
        doc_type: docType,
        page: pageData.page
      }
    });
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP
  });

  const chunks = [];
  let chunkIdx = 0;

  for (const rawDoc of rawDocuments) {
    const splitTexts = splitter.splitText(rawDoc.pageContent);
    for (const textPart of splitTexts) {
      chunks.push({
        pageContent: textPart,
        metadata: {
          ...rawDoc.metadata,
          chunk_index: chunkIdx++
        }
      });
    }
  }

  console.log(`[documentLoader] Processed '${filename}': ${pages.length} pages → ${chunks.length} chunks (type: ${docType})`);
  return chunks;
}

module.exports = {
  detectDocumentType,
  extractTextAndPages,
  loadAndChunk
};
