/**
 * app_api.js — Main Express API Server (Node.js Port)
 * 
 * Replaces the Python/Flask API backend on port 7860.
 * Serves React production static assets and supports chunked uploads, RAG pipelines, and study materials.
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { CHAT_MODEL, STUDY_MODEL, ALLOWED_MODELS } = require('./config');
const { extractTextAndPages } = require('./documentLoader');
const { createVectorStore } = require('./vectorStore');
const { RAGEngine, _NvidiaLLM, isImageVideoGen, CASUAL_SYSTEM_PROMPT } = require('./ragEngine');
const { GLOBAL_STATE } = require('./state');

const app = express();
const port = process.env.PORT || 7860;

// Keep-Alive Socket optimization headers to prevent handshake lag after client refresh
app.use((req, res, next) => {
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Keep-Alive", "timeout=60, max=100");
  next();
});

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Multi-part form chunk parser (max 5MB chunk limit)
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

// Static assets setup
const STATIC_DIR = path.join(__dirname, 'static_react');

// Constants for Session / Limits
const MAX_UPLOAD_SIZE = 500 * 1024 * 1024;  // 500 MB
const MAX_CHUNK_SIZE = 5 * 1024 * 1024;     // 5 MB
const CHUNK_DIR = path.join(__dirname, "data", "uploads", "chunks");
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "md"]);
const RATE_LIMIT_WINDOW = 60;   // seconds
const RATE_LIMIT_MAX = 30;      // max chunk uploads per window
const SESSION_TTL = 3600;       // 1 hour timeout

const UPLOAD_SESSIONS = {};
const RATE_LIMIT_STORE = {};
const INGESTION_STATUS = {};

// Ensure directories exist
fs.mkdirSync(CHUNK_DIR, { recursive: true });

/**
 * IP Rate Limit Check
 */
function checkRateLimit(ip) {
  const now = Date.now() / 1000;
  let entries = RATE_LIMIT_STORE[ip] || [];
  // Purge expired entries
  entries = entries.filter(t => now - t < RATE_LIMIT_WINDOW);
  if (entries.length >= RATE_LIMIT_MAX) {
    return false;
  }
  entries.push(now);
  RATE_LIMIT_STORE[ip] = entries;
  return true;
}

/**
 * Validate file extension
 */
function validateExtension(filename) {
  const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Purge expired upload sessions
 */
function purgeStaleSessions() {
  const now = Date.now() / 1000;
  for (const [uid, session] of Object.entries(UPLOAD_SESSIONS)) {
    if (now - session.created_at > SESSION_TTL) {
      const sessionDir = path.join(CHUNK_DIR, uid);
      if (fs.existsSync(sessionDir)) {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`[app_api] Failed to delete stale session dir ${sessionDir}:`, e);
        }
      }
      delete UPLOAD_SESSIONS[uid];
    }
  }
}

/**
 * Rebuild the vector store index in memory
 */
async function rebuildVectorStore() {
  try {
    if (GLOBAL_STATE.documents && GLOBAL_STATE.documents.length > 0) {
      GLOBAL_STATE.vector_store = await createVectorStore(GLOBAL_STATE.documents);
    } else {
      GLOBAL_STATE.vector_store = null;
    }
  } catch (err) {
    console.error("[app_api] Rebuild Vector Store Error:", err);
    GLOBAL_STATE.vector_store = null;
  }
}

/**
 * Index a direct file upload in the background
 */
async function bgIngestFile(trackerId, fileBytes, filename) {
  INGESTION_STATUS[trackerId] = {
    status: "processing",
    filename: filename,
    error: null
  };

  try {
    const { text, pages } = await extractTextAndPages(fileBytes, filename);
    if (!text.trim()) {
      throw new Error("Could not extract text from the file");
    }

    const chunksEstimate = Math.max(1, Math.floor(text.length / 1000));

    // Update global state documents
    GLOBAL_STATE.documents = GLOBAL_STATE.documents.filter(d => d.name !== filename);
    GLOBAL_STATE.documents.push({
      name: filename,
      text: text,
      pages: pages,
      chunks: chunksEstimate,
      size: text.length
    });

    GLOBAL_STATE.vector_store = await createVectorStore(GLOBAL_STATE.documents);

    INGESTION_STATUS[trackerId] = {
      status: "completed",
      filename: filename,
      error: null
    };
  } catch (err) {
    console.error(`[app_api] Bg Ingest Error:`, err);
    INGESTION_STATUS[trackerId] = {
      status: "failed",
      filename: filename,
      error: err.message
    };
  }
}

/**
 * Index a chunk-assembled file in the background
 */
async function bgIngestAssembled(trackerId, assembledPath, filename, sessionDir, uploadId) {
  INGESTION_STATUS[trackerId] = {
    status: "processing",
    filename: filename,
    error: null
  };

  try {
    const fileBytes = fs.readFileSync(assembledPath);
    if (fileBytes.length === 0) {
      throw new Error("Assembled file is empty");
    }

    const { text, pages } = await extractTextAndPages(fileBytes, filename);
    if (!text.trim()) {
      throw new Error("Could not extract text from the file");
    }

    const chunksEstimate = Math.max(1, Math.floor(text.length / 1000));

    GLOBAL_STATE.documents = GLOBAL_STATE.documents.filter(d => d.name !== filename);
    GLOBAL_STATE.documents.push({
      name: filename,
      text: text,
      pages: pages,
      chunks: chunksEstimate,
      size: text.length
    });

    GLOBAL_STATE.vector_store = await createVectorStore(GLOBAL_STATE.documents);

    // Clean up temporary session folder
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    delete UPLOAD_SESSIONS[uploadId];

    INGESTION_STATUS[trackerId] = {
      status: "completed",
      filename: filename,
      error: null
    };
  } catch (err) {
    console.error(`[app_api] Bg Ingest Finalize Error:`, err);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    delete UPLOAD_SESSIONS[uploadId];

    INGESTION_STATUS[trackerId] = {
      status: "failed",
      filename: filename,
      error: err.message
    };
  }
}

// ── Express routes ──

/**
 * Legacy API-key endpoint kept for backward compatibility.
 */
app.all("/api/api-key", (req, res) => {
  if (req.method === "POST") {
    return res.json({ message: "API Key saved successfully" });
  }
  return res.json({ has_key: true });
});

/**
 * Direct file upload handler (short-circuit path)
 */
app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  let filename = req.file.originalname;
  // basic sanitization of filename characters
  filename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!filename) {
    filename = "uploaded_file";
  }

  try {
    const fileBytes = req.file.buffer;
    if (!fileBytes || fileBytes.length === 0) {
      return res.status(400).json({ error: "Uploaded file is empty" });
    }

    const trackerId = uuidv4().replace(/-/g, '');
    INGESTION_STATUS[trackerId] = {
      status: "pending",
      filename: filename,
      error: null
    };

    // Index asynchronously in the background
    bgIngestFile(trackerId, fileBytes, filename);

    return res.status(202).json({
      message: "Upload accepted for background processing",
      status: "accepted",
      tracker_id: trackerId
    });
  } catch (err) {
    console.error("[app_api] Upload Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Initialize chunked upload
 */
app.post("/api/upload/init", (req, res) => {
  purgeStaleSessions();

  const data = req.body || {};
  const filename = (data.filename || "").trim();
  const totalSize = data.total_size || 0;
  const totalChunks = data.total_chunks || 0;
  const contentType = data.content_type || "";

  if (!filename) {
    return res.status(400).json({ error: "Filename is required" });
  }

  // Sanitize filename
  let safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeName) safeName = "uploaded_file";

  if (!validateExtension(safeName)) {
    const sortedAllowed = Array.from(ALLOWED_EXTENSIONS).sort().join(", ");
    return res.status(400).json({
      error: `File type not allowed. Supported: ${sortedAllowed} (Text documents only — no images)`
    });
  }

  if (totalSize > MAX_UPLOAD_SIZE) {
    return res.status(400).json({
      error: `File exceeds maximum size of ${MAX_UPLOAD_SIZE / (1024 * 1024)} MB`
    });
  }

  if (totalChunks < 1 || totalChunks > 100000) {
    return res.status(400).json({ error: "Invalid chunk count" });
  }

  const uploadId = uuidv4().replace(/-/g, '');
  const sessionDir = path.join(CHUNK_DIR, uploadId);
  fs.mkdirSync(sessionDir, { recursive: true });

  UPLOAD_SESSIONS[uploadId] = {
    filename: safeName,
    total_size: totalSize,
    total_chunks: totalChunks,
    content_type: contentType,
    received: new Set(),
    created_at: Date.now() / 1000
  };

  return res.json({ upload_id: uploadId, uploadId: uploadId, filename: safeName });
});

/**
 * Upload single chunk
 */
app.post("/api/upload/chunk", upload.single("chunk"), (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || "unknown";
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: "Rate limit exceeded. Try again shortly." });
  }

  const uploadId = req.body.upload_id || "";
  const chunkIndexStr = req.body.chunk_index || "";
  const chunkHash = req.body.chunk_hash || "";

  const session = UPLOAD_SESSIONS[uploadId];
  if (!session) {
    return res.status(404).json({ error: "Invalid or expired upload session" });
  }

  const chunkIndex = parseInt(chunkIndexStr, 10);
  if (isNaN(chunkIndex) || chunkIndex < 0 || chunkIndex >= session.total_chunks) {
    return res.status(400).json({ error: "Invalid or out of range chunk index" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "No chunk data provided" });
  }

  const chunkData = req.file.buffer;
  if (chunkData.length > MAX_CHUNK_SIZE) {
    return res.status(400).json({ error: `Chunk exceeds max size of ${MAX_CHUNK_SIZE / (1024 * 1024)} MB` });
  }

  if (chunkHash) {
    const computed = crypto.createHash('sha256').update(chunkData).digest('hex');
    if (computed !== chunkHash) {
      return res.status(400).json({
        error: "Chunk integrity check failed",
        expected: chunkHash,
        received: computed
      });
    }
  }

  const chunkPath = path.join(CHUNK_DIR, uploadId, `chunk_${String(chunkIndex).padStart(6, '0')}.bin`);
  fs.writeFileSync(chunkPath, chunkData);

  session.received.add(chunkIndex);

  return res.json({
    received: chunkIndex,
    verified: true,
    total_received: session.received.size,
    total_chunks: session.total_chunks
  });
});

/**
 * Finalize chunked upload and assemble file
 */
app.post("/api/upload/finalize", (req, res) => {
  const data = req.body || {};
  const uploadId = data.upload_id || "";

  const session = UPLOAD_SESSIONS[uploadId];
  if (!session) {
    return res.status(404).json({ error: "Invalid or expired upload session" });
  }

  const missing = [];
  for (let i = 0; i < session.total_chunks; i++) {
    if (!session.received.has(i)) {
      missing.push(i);
    }
  }

  if (missing.length > 0) {
    return res.status(400).json({
      error: "Missing chunks",
      missing: missing
    });
  }

  const sessionDir = path.join(CHUNK_DIR, uploadId);
  const assembledPath = path.join(sessionDir, session.filename);

  try {
    // Write out assembled file
    const outStream = fs.createWriteStream(assembledPath);
    for (let i = 0; i < session.total_chunks; i++) {
      const chunkPath = path.join(sessionDir, `chunk_${String(i).padStart(6, '0')}.bin`);
      const chunkData = fs.readFileSync(chunkPath);
      outStream.write(chunkData);
    }
    outStream.end();

    const trackerId = uuidv4().replace(/-/g, '');
    INGESTION_STATUS[trackerId] = {
      status: "pending",
      filename: session.filename,
      error: null
    };

    // Index the assembled file asynchronously in the background
    bgIngestAssembled(trackerId, assembledPath, session.filename, sessionDir, uploadId);

    return res.status(202).json({
      message: "Finalization accepted for processing",
      status: "accepted",
      tracker_id: trackerId
    });
  } catch (err) {
    console.error("[app_api] Finalize Error:", err);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    delete UPLOAD_SESSIONS[uploadId];
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Poll background indexing/ingestion status
 */
app.get("/api/upload/status/:tracker_id", (req, res) => {
  const trackerId = req.params.tracker_id;
  const statusInfo = INGESTION_STATUS[trackerId];
  if (!statusInfo) {
    return res.status(404).json({ error: "Tracker ID not found" });
  }
  return res.json(statusInfo);
});

/**
 * Cancel upload session
 */
app.delete("/api/upload/:upload_id", (req, res) => {
  const uploadId = req.params.upload_id;
  if (!UPLOAD_SESSIONS[uploadId]) {
    return res.status(404).json({ error: "Upload session not found" });
  }

  const sessionDir = path.join(CHUNK_DIR, uploadId);
  if (fs.existsSync(sessionDir)) {
    try {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    } catch (e) {
      console.error(`[app_api] Failed to delete session dir ${sessionDir}:`, e);
    }
  }

  delete UPLOAD_SESSIONS[uploadId];
  return res.json({ message: "Upload cancelled" });
});

/**
 * Get upload status details
 */
app.get("/api/upload/status-details/:upload_id", (req, res) => {
  const uploadId = req.params.upload_id;
  const session = UPLOAD_SESSIONS[uploadId];
  if (!session) {
    return res.status(404).json({ error: "Upload session not found" });
  }

  return res.json({
    upload_id: uploadId,
    filename: session.filename,
    total_chunks: session.total_chunks,
    received_chunks: session.received.size,
    received: Array.from(session.received).sort((a, b) => a - b)
  });
});

/**
 * Get active documents list
 */
app.get("/api/documents", (req, res) => {
  const docs = [];
  let totalChunks = 0;
  for (const doc of GLOBAL_STATE.documents) {
    docs.push({
      name: doc.name,
      chunks: doc.chunks,
      size_formatted: `${Math.round(doc.size / 1024)} KB`
    });
    totalChunks += doc.chunks;
  }

  return res.json({
    documents: docs,
    total_chunks: totalChunks
  });
});

/**
 * Delete a document
 */
app.delete("/api/documents/:filename", (req, res) => {
  const filename = req.params.filename;
  const initialLength = GLOBAL_STATE.documents.length;
  GLOBAL_STATE.documents = GLOBAL_STATE.documents.filter(d => d.name !== filename);

  if (GLOBAL_STATE.documents.length !== initialLength) {
    // Rebuild vector store in background
    rebuildVectorStore();
    return res.json({ message: "Document deleted" });
  } else {
    return res.status(404).json({ error: "Document not found" });
  }
});

/**
 * Retrieve matching chunks
 */
app.get("/api/documents/search", async (req, res) => {
  const query = (req.query.query || "").trim();
  if (!query) {
    return res.json({ results: [] });
  }

  const vs = GLOBAL_STATE.vector_store;
  if (!vs) {
    return res.json({ results: [], info: "Vector store is empty. Please upload documents first." });
  }

  try {
    const docs = await vs.similaritySearch(query, 5);
    const results = docs.map(doc => ({
      content: doc.pageContent,
      metadata: doc.metadata || {}
    }));
    return res.json({ results });
  } catch (err) {
    console.error("[app_api] Vector Search API Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Clear conversation history
 */
app.post("/api/clear-history", (req, res) => {
  if (GLOBAL_STATE.chat_engine) {
    GLOBAL_STATE.chat_engine.clearHistory();
  }
  return res.json({ message: "Chat history cleared" });
});

/**
 * Prewarm search query results in the background
 */
app.post("/api/prewarm", (req, res) => {
  const data = req.body || {};
  const query = (data.query || "").trim();

  if (!query || query.length < 4) {
    return res.json({ status: "ignored" });
  }

  // Prewarm asynchronously
  (async () => {
    try {
      let engine = GLOBAL_STATE.chat_engine;
      if (!engine) {
        engine = new RAGEngine(GLOBAL_STATE.vector_store, CHAT_MODEL);
        GLOBAL_STATE.chat_engine = engine;
      } else {
        engine.vectorStore = GLOBAL_STATE.vector_store;
      }

      if (engine.vectorStore) {
        const retriever = engine.vectorStore.asRetriever({ k: 2 });
        const docs = await retriever.invoke(query);
        GLOBAL_STATE.prewarm_cache[query.toLowerCase()] = docs;
      }
    } catch (err) {
      console.error("[app_api] Prewarm Background Error:", err);
    }
  })();

  return res.json({ status: "prewarming_started" });
});

/**
 * Chat query router supporting direct JSON or Server-Sent Events stream
 */
app.post("/api/chat", async (req, res) => {
  const data = req.body || {};
  
  // 1. Clean and normalize the query
  const useMessageKey = 'message' in data;
  let rawQuery = useMessageKey ? data.message : data.query;
  rawQuery = (rawQuery || "").trim();
  const cleanQuery = rawQuery.toLowerCase().replace(/\?/g, '').trim();

  if (!cleanQuery) {
    return res.status(400).json({ error: "Query cannot be empty" });
  }

  try {
    // Check and retrieve RAGEngine
    let engine = GLOBAL_STATE.chat_engine;
    if (!engine) {
      engine = new RAGEngine(GLOBAL_STATE.vector_store, CHAT_MODEL);
      GLOBAL_STATE.chat_engine = engine;
    } else {
      engine.vectorStore = GLOBAL_STATE.vector_store;
    }

    // Intercept JSON/non-streaming mode requests early
    if (useMessageKey) {
      if (isImageVideoGen(cleanQuery)) {
        const fallbackMsg = (
          "⚠️ **Content Warning**\n\n" +
          "Your request was flagged by content safety filters. " +
          "Please rephrase your query to be respectful and study-focused."
        );
        return res.json({ response: fallbackMsg });
      }

      if (['hi', 'hii', 'hiii', 'hello', 'hey', 'yo'].includes(cleanQuery)) {
        const reply = "How can I help you today?";
        return res.json({ response: reply });
      }

      if (['how are you', 'how r u', 'whats up', 'who are you'].includes(cleanQuery)) {
        let replyContent = "";
        try {
          const rawLlm = engine.llm;
          const messages = [
            { role: 'system', content: CASUAL_SYSTEM_PROMPT }
          ];
          if (engine.history.length > 0) {
            messages.push(...engine.history.slice(-6));
          }
          messages.push({ role: 'user', content: rawQuery });

          const result = await rawLlm.invoke(messages);
          replyContent = result.content || "";
        } catch (err) {
          const errMsg = err.message || "";
          if (errMsg.includes("CONTENT_SAFETY_ERROR") || ["content safety", "safety warning", "safety policy", "moderation"].some(kw => errMsg.toLowerCase().includes(kw))) {
            replyContent = "⚠️ **Content Warning**: Your request was flagged by content safety filters.";
          } else {
            replyContent = "I'm doing great, thank you for asking! How can I assist you with your studies today?";
          }
        }
        return res.json({ response: replyContent });
      }
    }

    // TIER 3: ACADEMIC / DOCUMENT QUERIES (Streaming Event Yield)
    let prewarmedDocs = null;
    const qLower = rawQuery.toLowerCase();
    for (const [cachedQ, docs] of Object.entries(GLOBAL_STATE.prewarm_cache)) {
      if (qLower.startsWith(cachedQ) || cachedQ.startsWith(qLower)) {
        prewarmedDocs = docs;
        delete GLOBAL_STATE.prewarm_cache[cachedQ];
        break;
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    try {
      for await (const chunk of engine.streamGenerateResponse(rawQuery, prewarmedDocs)) {
        res.write(chunk);
        // Flush immediately — prevents TCP/Express buffering which causes first-token lag
        if (typeof res.flush === 'function') res.flush();
      }
      res.end();
    } catch (streamErr) {
      console.error("[app_api] SSE Stream error:", streamErr);
      res.write(`data: ${JSON.stringify({ error: streamErr.message })}\n\n`);
      if (typeof res.flush === 'function') res.flush();
      res.end();
    }

  } catch (err) {
    console.error("[app_api] Chat route error:", err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get document contents
 */
app.get("/api/documents/content", (req, res) => {
  const filename = (req.query.name || "").trim();
  if (!filename) {
    return res.status(400).json({ error: "Document name is required" });
  }

  const doc = GLOBAL_STATE.documents.find(d => d.name === filename);
  if (doc) {
    return res.json({
      name: doc.name,
      text: doc.text
    });
  }

  return res.status(404).json({ error: "Document not found" });
});

/**
 * Mock study material helper function
 */
function buildLocalStudyMaterials(materialType, sampleText) {
  const sentences = sampleText
    .split(/[.!?]+|\n+/)
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(s => s.length > 35);

  const finalSentences = sentences.length > 0 ? sentences : [sampleText.replace(/\s+/g, ' ').trim() || "Review the uploaded document."];

  function short(str, limit = 180) {
    if (str.length <= limit) return str;
    const truncated = str.slice(0, limit);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace !== -1 ? truncated.slice(0, lastSpace) + '...' : truncated + '...';
  }

  if (materialType === "flashcards") {
    const cards = [];
    for (let i = 0; i < 4; i++) {
      const sentence = finalSentences[i % finalSentences.length];
      cards.push({
        question: `What is key point ${i + 1} from this document?`,
        answer: short(sentence, 220)
      });
    }
    return cards;
  }

  if (materialType === "quiz") {
    const quizItems = [];
    for (let i = 0; i < 3; i++) {
      const sentence = finalSentences[i % finalSentences.length];
      quizItems.push({
        question: `Which statement best matches key point ${i + 1}?`,
        options: [
          short(sentence, 160),
          "This topic is unrelated to the uploaded material.",
          "The document does not discuss this concept.",
          "This point should be ignored during revision."
        ],
        correctIndex: 0,
        explanation: "This option is taken from the indexed document text."
      });
    }
    return quizItems;
  }

  const milestones = [];
  for (let i = 0; i < 3; i++) {
    const sentence = finalSentences[i % finalSentences.length];
    milestones.push({
      title: `Milestone ${i + 1}`,
      description: short(sentence, 180),
      tasks: [
        "Read the related section carefully.",
        "Write short notes in your own words.",
        "Practice two questions from this concept."
      ]
    });
  }
  return milestones;
}

/**
 * Extract and parse JSON helper
 */
function extractAndParseJson(text) {
  let candidate = text.trim();
  const codeBlockMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(candidate);
  if (codeBlockMatch) {
    candidate = codeBlockMatch[1].trim();
  }

  const firstIdx = Math.min(
    ...[candidate.indexOf('['), candidate.indexOf('{')].filter(idx => idx !== -1)
  );
  const lastIdx = Math.max(
    ...[candidate.lastIndexOf(']'), candidate.lastIndexOf('}')].filter(idx => idx !== -1)
  );

  if (firstIdx !== -1 && lastIdx !== -1 && firstIdx < lastIdx) {
    candidate = candidate.slice(firstIdx, lastIdx + 1);
  }

  candidate = candidate.trim();

  // Auto-close brackets
  if (candidate.startsWith('[') && !candidate.endsWith(']')) {
    const lastObjEnd = candidate.lastIndexOf('}');
    candidate = lastObjEnd !== -1 ? candidate.slice(0, lastObjEnd + 1) + ']' : candidate + ']';
  } else if (candidate.startsWith('{') && !candidate.endsWith('}')) {
    candidate += '}';
  }

  // Remove trailing commas
  candidate = candidate.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(candidate);
  } catch (err) {
    try {
      return JSON.parse(text);
    } catch (e) {
      throw err;
    }
  }
}

/**
 * Study materials generator using STUDY_MODEL
 */
app.post("/api/study/generate", async (req, res) => {
  const data = req.body || {};
  const materialType = data.type || "flashcards";
  const filename = data.filename || "";

  let docText = "";
  if (filename) {
    const doc = GLOBAL_STATE.documents.find(d => d.name === filename);
    if (doc) docText = doc.text;
  } else {
    if (GLOBAL_STATE.documents.length > 0) {
      docText = GLOBAL_STATE.documents[0].text;
    }
  }

  if (!docText) {
    return res.status(400).json({ error: "No indexed documents found. Please upload a file first." });
  }

  const sampleText = docText.slice(0, 4000);
  let prompt = "";

  if (materialType === "flashcards") {
    prompt = (
      `Based on the following text, generate exactly 4 high-quality flashcards. ` +
      `Format the output strictly as a minified JSON array of objects, where each object has 'question' and 'answer' fields. ` +
      `Do not include markdown formatting, markdown wrappers, backticks, or any other explanations. Return ONLY the raw valid JSON.\n\nText:\n${sampleText}`
    );
  } else if (materialType === "quiz") {
    prompt = (
      `Based on the following text, generate exactly 3 multiple-choice questions. ` +
      `Format the output strictly as a minified JSON array of objects, where each object has ` +
      `'question', 'options' (an array of 4 string options), 'correctIndex' (0-indexed integer of the correct option), ` +
      `and 'explanation' (why it is correct) fields. ` +
      `Do not include markdown formatting, markdown wrappers, backticks, or any other explanations. Return ONLY the raw valid JSON.\n\nText:\n${sampleText}`
    );
  } else if (materialType === "roadmap") {
    prompt = (
      `Based on the following text, generate an academic study roadmap with exactly 3 milestones. ` +
      `Format the output strictly as a minified JSON array of objects, where each object has ` +
      `'title' (milestone title), 'description' (what to learn), and 'tasks' (an array of 3 specific action tasks) fields. ` +
      `Do not include markdown formatting, markdown wrappers, backticks, or any other explanations. Return ONLY the raw valid JSON.\n\nText:\n${sampleText}`
    );
  } else {
    return res.status(400).json({ error: "Invalid material type" });
  }

  try {
    let engine = GLOBAL_STATE.study_engine;
    if (!engine) {
      engine = new RAGEngine(null, STUDY_MODEL);
      GLOBAL_STATE.study_engine = engine;
    }

    const messages = [
      { role: 'system', content: "You are a JSON generator. You output only raw, valid JSON arrays. Never output code blocks, markdown wrapper, or conversational filler." },
      { role: 'user', content: prompt }
    ];

    let content = "";
    try {
      const response = await engine.llm.invoke(messages);
      content = (response.content || "").trim();
    } catch (invokeErr) {
      console.warn(`[app_api] Primary model invocation failed: ${invokeErr.message}. Using local materials.`);
      return res.json({ data: buildLocalStudyMaterials(materialType, sampleText), fallback: true });
    }

    try {
      const parsedJson = extractAndParseJson(content);
      return res.json({ data: parsedJson });
    } catch (parseErr) {
      console.warn(`[app_api] Could not parse model JSON: ${parseErr.message}. Using local materials.`);
      return res.json({ data: buildLocalStudyMaterials(materialType, sampleText), fallback: true });
    }

  } catch (err) {
    console.error("[app_api] Study Gen Error:", err);
    return res.json({ data: buildLocalStudyMaterials(materialType, sampleText), fallback: true });
  }
});

/**
 * Health / readiness route
 */
app.get("/api/health", (req, res) => {
  const warmupDone = GLOBAL_STATE.warmup_complete || false;
  const chatReady = GLOBAL_STATE.chat_engine !== null;
  const studyReady = GLOBAL_STATE.study_engine !== null;
  return res.json({
    status: warmupDone ? "ready" : "warming_up",
    warmup_complete: warmupDone,
    chat_engine_ready: chatReady,
    study_engine_ready: studyReady
  });
});

/**
 * Serve frontend assets and fallback index.html for client side routers
 */
app.get("*", (req, res) => {
  const target = path.join(STATIC_DIR, req.path);
  if (req.path && req.path !== "/" && fs.existsSync(target) && fs.statSync(target).isFile()) {
    return res.sendFile(target);
  }
  return res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// App Startup Warmup
async function warmupApp() {
  console.log("Pre-warming AskiFy Pro model connection pipeline...");

  // Warm up Chat Engine
  try {
    const engineChat = new RAGEngine(null, CHAT_MODEL);
    GLOBAL_STATE.chat_engine = engineChat;
    console.log(`[Warmup] Chat: ${CHAT_MODEL} initialized. Performing eager connection warmup...`);
    await engineChat.llm.invoke("ping").catch(() => {});
    console.log(`[Warmup] Chat: ${CHAT_MODEL} pipeline successfully hot-loaded.`);
  } catch (err) {
    console.error(`[Warmup] Chat ${CHAT_MODEL} failed:`, err);
  }

  // Warm up Study Engine
  try {
    const engineStudy = new RAGEngine(null, STUDY_MODEL);
    GLOBAL_STATE.study_engine = engineStudy;
    console.log(`[Warmup] Study: ${STUDY_MODEL} initialized. Performing eager connection warmup...`);
    await engineStudy.llm.invoke("ping").catch(() => {});
    console.log(`[Warmup] Study: ${STUDY_MODEL} pipeline successfully hot-loaded.`);
  } catch (err) {
    console.error(`[Warmup] Study ${STUDY_MODEL} failed:`, err);
  }

  GLOBAL_STATE.warmup_complete = true;
  console.log("[Warmup] Complete.");
}

// Start Server and Warmup
app.listen(port, () => {
  console.log(`\n============================================================`);
  console.log(`🚀  ASKIFY RUNNING (Node.js/Express.js Backend)`);
  console.log(`============================================================`);
  console.log(`📡 Backend API:     http://127.0.0.1:${port}`);
  console.log(`🌐 Frontend (prod): http://127.0.0.1:${port}`);
  console.log(`💚 Health Check:    http://127.0.0.1:${port}/api/health`);
  console.log(`============================================================\n`);
  
  // Trigger warmup task on boot
  warmupApp();
});
