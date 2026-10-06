/**
 * server.js — Main Express API Server (Node.js Fullstack Backend)
 * 
 * Runs on port 7860. Supports chunked uploads, NVIDIA Nemotron RAG pipelines, and interactive study hub.
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { 
  CHAT_MODEL, 
  STUDY_MODEL, 
  CHUNK_DIR, 
  STATIC_DIR, 
  UPLOAD_DIR, 
  ALLOWED_EXTENSIONS 
} = require('./src/config');
const { extractTextAndPages } = require('./src/documentLoader');
const { createVectorStore } = require('./src/vectorStore');
const { RAGEngine, _NvidiaLLM, isImageVideoGen, CASUAL_SYSTEM_PROMPT } = require('./src/ragEngine');
const { GLOBAL_STATE } = require('./src/state');
const { getLearningDecision } = require('./src/services/layaService');
const { metrics } = require('./src/metrics');
const { structuredLogger } = require('./src/logger');
const { enhanceResearchQuery, generateFollowUpQuestions } = require('./src/services/queryEnhancer');

const app = express();
const port = process.env.PORT || 7860;

// Keep-Alive socket optimization
app.use((req, res, next) => {
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Keep-Alive", "timeout=60, max=100");
  next();
});

app.use(cors());
app.use(express.json());
app.use(structuredLogger);

const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } });

const MAX_UPLOAD_SIZE = 500 * 1024 * 1024;  // 500 MB
const RATE_LIMIT_WINDOW = 60;                // seconds
const RATE_LIMIT_MAX = 30;                   // max uploads per window
const SESSION_TTL = 3600;                    // 1 hour timeout

const UPLOAD_SESSIONS = {};
const RATE_LIMIT_STORE = {};
const INGESTION_STATUS = {};

// Ensure required directories exist
fs.mkdirSync(CHUNK_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function checkRateLimit(ip) {
  const now = Date.now() / 1000;
  let entries = RATE_LIMIT_STORE[ip] || [];
  entries = entries.filter(t => now - t < RATE_LIMIT_WINDOW);
  if (entries.length >= RATE_LIMIT_MAX) {
    return false;
  }
  entries.push(now);
  RATE_LIMIT_STORE[ip] = entries;
  return true;
}

function validateExtension(filename) {
  const ext = filename.includes(".") ? filename.split(".").pop().toLowerCase() : "";
  return ALLOWED_EXTENSIONS.includes(ext);
}

function purgeStaleSessions() {
  const now = Date.now() / 1000;
  for (const [uid, session] of Object.entries(UPLOAD_SESSIONS)) {
    if (now - session.created_at > SESSION_TTL) {
      const sessionDir = path.join(CHUNK_DIR, uid);
      if (fs.existsSync(sessionDir)) {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (e) {
          console.error(`[server] Failed to delete stale session dir ${sessionDir}:`, e);
        }
      }
      delete UPLOAD_SESSIONS[uid];
    }
  }
}

setInterval(purgeStaleSessions, 15 * 60 * 1000);

async function rebuildVectorStore() {
  try {
    if (GLOBAL_STATE.documents && GLOBAL_STATE.documents.length > 0) {
      console.log(`[server] Rebuilding vector store for ${GLOBAL_STATE.documents.length} document(s)...`);
      GLOBAL_STATE.vector_store = await createVectorStore(GLOBAL_STATE.documents);
      if (GLOBAL_STATE.chat_engine) {
        GLOBAL_STATE.chat_engine.vectorStore = GLOBAL_STATE.vector_store;
      }
      console.log("[server] Vector store rebuild completed.");
    } else {
      GLOBAL_STATE.vector_store = null;
      if (GLOBAL_STATE.chat_engine) {
        GLOBAL_STATE.chat_engine.vectorStore = null;
      }
      console.log("[server] Vector store cleared (no active documents).");
    }
  } catch (err) {
    console.error("[server] Failed to rebuild vector store:", err);
  }
}

// ─────────────────────────────────────────────────────────────
// CHUNKED UPLOAD ROUTES
// ─────────────────────────────────────────────────────────────

app.post("/api/upload/init", (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || "unknown";
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({ error: "Rate limit exceeded. Please wait a moment." });
  }

  const { filename, total_size, total_chunks, content_type } = req.body || {};

  if (!filename || !validateExtension(filename)) {
    return res.status(400).json({
      error: `Invalid file extension. Allowed formats: ${ALLOWED_EXTENSIONS.join(", ")}`
    });
  }

  if (typeof total_size === "number" && total_size > MAX_UPLOAD_SIZE) {
    return res.status(413).json({ error: "Total file size exceeds the 500 MB limit." });
  }

  const uploadId = uuidv4();
  const sessionDir = path.join(CHUNK_DIR, uploadId);
  fs.mkdirSync(sessionDir, { recursive: true });

  UPLOAD_SESSIONS[uploadId] = {
    filename,
    total_size: total_size || 0,
    total_chunks: total_chunks || 1,
    content_type: content_type || "application/octet-stream",
    chunks_received: new Set(),
    created_at: Date.now() / 1000
  };

  return res.json({
    upload_id: uploadId,
    chunk_size: 5 * 1024 * 1024,
    message: "Upload session initialized successfully"
  });
});

app.post("/api/upload/chunk", upload.single("chunk"), (req, res) => {
  const uploadId = req.body.upload_id;
  const chunkIndex = parseInt(req.body.chunk_index, 10);
  const clientHash = req.body.chunk_hash;

  if (!uploadId || !UPLOAD_SESSIONS[uploadId]) {
    return res.status(404).json({ error: "Upload session not found or expired" });
  }

  if (isNaN(chunkIndex)) {
    return res.status(400).json({ error: "Valid chunk_index required" });
  }

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: "No chunk file data provided" });
  }

  const chunkData = req.file.buffer;

  if (clientHash) {
    const computedHash = crypto.createHash("sha256").update(chunkData).digest("hex");
    if (computedHash.toLowerCase() !== clientHash.toLowerCase()) {
      return res.status(400).json({ error: "Chunk checksum verification failed" });
    }
  }

  const session = UPLOAD_SESSIONS[uploadId];
  const chunkFilePath = path.join(CHUNK_DIR, uploadId, `chunk_${chunkIndex}`);

  try {
    fs.writeFileSync(chunkFilePath, chunkData);
    session.chunks_received.add(chunkIndex);

    return res.json({
      upload_id: uploadId,
      chunk_index: chunkIndex,
      chunks_received: session.chunks_received.size,
      total_chunks: session.total_chunks,
      complete: session.chunks_received.size === session.total_chunks
    });
  } catch (err) {
    console.error(`[server] Chunk write error:`, err);
    return res.status(500).json({ error: "Failed to persist chunk data" });
  }
});

app.post("/api/upload/finalize", async (req, res) => {
  const { upload_id: uploadId } = req.body || {};

  if (!uploadId || !UPLOAD_SESSIONS[uploadId]) {
    return res.status(404).json({ error: "Upload session not found or expired" });
  }

  const session = UPLOAD_SESSIONS[uploadId];
  if (session.chunks_received.size !== session.total_chunks) {
    return res.status(400).json({
      error: `Missing chunks. Received ${session.chunks_received.size} of ${session.total_chunks}`
    });
  }

  const sanitizedBase = path.basename(session.filename);
  const assembledFilePath = path.join(CHUNK_DIR, `${uploadId}_${sanitizedBase}`);
  const writeStream = fs.createWriteStream(assembledFilePath);

  for (let i = 0; i < session.total_chunks; i++) {
    const chunkPath = path.join(CHUNK_DIR, uploadId, `chunk_${i}`);
    if (!fs.existsSync(chunkPath)) {
      writeStream.close();
      return res.status(400).json({ error: `Corrupt session: chunk_${i} missing on disk` });
    }
    const chunkBuffer = fs.readFileSync(chunkPath);
    writeStream.write(chunkBuffer);
  }
  writeStream.end();

  await new Promise((resolve, reject) => {
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });

  // Cleanup chunks folder
  const sessionDir = path.join(CHUNK_DIR, uploadId);
  try {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  } catch (e) {
    console.warn(`[server] Could not delete chunk session dir: ${e.message}`);
  }
  delete UPLOAD_SESSIONS[uploadId];

  const trackerId = uuidv4();
  INGESTION_STATUS[trackerId] = {
    status: "processing",
    filename: session.filename,
    start_time: Date.now()
  };

  // Asynchronous background ingestion
  (async () => {
    try {
      const fileBuffer = fs.readFileSync(assembledFilePath);
      const { text, pages } = await extractTextAndPages(fileBuffer, session.filename);

      if (!text || text.trim().length === 0) {
        throw new Error("Could not extract any readable text from document");
      }

      GLOBAL_STATE.documents = GLOBAL_STATE.documents.filter(d => d.name !== session.filename);
      GLOBAL_STATE.documents.push({
        name: session.filename,
        text,
        pages,
        chunks: pages.length,
        size: fs.statSync(assembledFilePath).size
      });

      await rebuildVectorStore();

      INGESTION_STATUS[trackerId] = {
        status: "completed",
        filename: session.filename,
        chunks: pages.length,
        total_documents: GLOBAL_STATE.documents.length
      };

      try {
        fs.unlinkSync(assembledFilePath);
      } catch (e) {}

    } catch (err) {
      console.error(`[server] Async ingestion error for ${session.filename}:`, err);
      INGESTION_STATUS[trackerId] = {
        status: "failed",
        filename: session.filename,
        error: err.message
      };
      try {
        if (fs.existsSync(assembledFilePath)) fs.unlinkSync(assembledFilePath);
      } catch (e) {}
    }
  })();

  return res.json({
    status: "processing",
    tracker_id: trackerId,
    message: "File reassembled successfully. Processing in background."
  });
});

app.get("/api/upload/status/:trackerId", (req, res) => {
  const tracker = INGESTION_STATUS[req.params.trackerId];
  if (!tracker) {
    return res.status(404).json({ error: "Tracker ID not found" });
  }
  return res.json(tracker);
});

// ─────────────────────────────────────────────────────────────
// DOCUMENT MANAGEMENT
// ─────────────────────────────────────────────────────────────

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

app.delete("/api/documents/:filename", (req, res) => {
  const filename = req.params.filename;
  const initialLength = GLOBAL_STATE.documents.length;
  GLOBAL_STATE.documents = GLOBAL_STATE.documents.filter(d => d.name !== filename);

  if (GLOBAL_STATE.documents.length !== initialLength) {
    rebuildVectorStore();
    return res.json({ message: "Document deleted" });
  } else {
    return res.status(404).json({ error: "Document not found" });
  }
});

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
    console.error("[server] Vector search error:", err);
    return res.status(500).json({ error: err.message });
  }
});

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

// ─────────────────────────────────────────────────────────────
// CHAT & RAG ENGINE
// ─────────────────────────────────────────────────────────────

app.post("/api/clear-history", (req, res) => {
  if (GLOBAL_STATE.chat_engine) {
    GLOBAL_STATE.chat_engine.clearHistory();
  }
  return res.json({ message: "Chat history cleared" });
});

app.post("/api/prewarm", (req, res) => {
  const data = req.body || {};
  const query = (data.query || "").trim();

  if (!query || query.length < 4) {
    return res.json({ status: "ignored" });
  }

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
      console.error("[server] Prewarm error:", err);
    }
  })();

  return res.json({ status: "prewarming_started" });
});

// ─────────────────────────────────────────────────────────────
// ACADEMIC QUERY ENHANCER & FOLLOW-UP SUGGESTER
// ─────────────────────────────────────────────────────────────

app.post("/api/query/enhance", (req, res) => {
  const { query } = req.body || {};
  if (!query || !query.trim()) {
    return res.status(400).json({ error: "Query is required" });
  }
  const original = query.trim();
  const enhanced = enhanceResearchQuery(original);
  const followUps = generateFollowUpQuestions(original);
  return res.json({ original, enhanced, followUps });
});

// In-flight request deduplication map (prevents identical concurrent storms)
const IN_FLIGHT_CHATS = new Map();

app.post("/api/chat", async (req, res) => {
  const data = req.body || {};
  const useMessageKey = 'message' in data;
  let rawQuery = useMessageKey ? data.message : data.query;
  rawQuery = (rawQuery || "").trim();
  const cleanQuery = rawQuery.toLowerCase().replace(/\?/g, '').trim();

  if (!cleanQuery) {
    return res.status(400).json({ error: "Query cannot be empty" });
  }

  // Request Deduplication Guard: Avoid concurrent duplicate LLM invocations within 1000ms
  const now = Date.now();
  if (IN_FLIGHT_CHATS.has(cleanQuery)) {
    const prevTimestamp = IN_FLIGHT_CHATS.get(cleanQuery);
    if (now - prevTimestamp < 1000) {
      console.warn(`[server] Deduplicating rapid concurrent request for query: "${cleanQuery.slice(0, 30)}..."`);
      return res.status(429).json({ error: "Duplicate query already in-flight. Please wait a moment." });
    }
  }
  IN_FLIGHT_CHATS.set(cleanQuery, now);
  setTimeout(() => IN_FLIGHT_CHATS.delete(cleanQuery), 5000);

  try {
    let engine = GLOBAL_STATE.chat_engine;
    if (!engine) {
      engine = new RAGEngine(GLOBAL_STATE.vector_store, CHAT_MODEL);
      GLOBAL_STATE.chat_engine = engine;
    } else {
      engine.vectorStore = GLOBAL_STATE.vector_store;
    }

    // Call Laya Structured Decision Service
    const { userProfile, learningProgress, requestedFeature } = data;
    const learningPlan = await getLearningDecision({
      studentMessage: rawQuery,
      requestedFeature: requestedFeature || "none",
      userProfile,
      learningProgress,
      documentContextAvailable: GLOBAL_STATE.documents.length > 0
    });

    // Direct JSON response for synchronous clients
    if (useMessageKey) {
      if (isImageVideoGen(cleanQuery)) {
        return res.json({ 
          response: "⚠️ AskiFy is an academic study assistant. Image/video generation tasks are not supported.",
          learningPlan 
        });
      }

      if (['hi', 'hello', 'hey'].includes(cleanQuery)) {
        return res.json({ 
          response: "Hello! How can I assist you with your academic studies today?",
          learningPlan 
        });
      }

      const messages = [
        { role: 'system', content: CASUAL_SYSTEM_PROMPT },
        { role: 'user', content: rawQuery }
      ];
      try {
        const result = await engine.llm.invoke(messages);
        return res.json({ response: result.content || "", learningPlan });
      } catch (err) {
        return res.json({ 
          response: "I am ready to help you analyze your documents and answer your questions!", 
          learningPlan 
        });
      }
    }

    // Streaming response with SSE
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
    if (req.socket) req.socket.setTimeout(0);

    try {
      for await (const chunk of engine.streamGenerateResponse(rawQuery, prewarmedDocs, learningPlan)) {
        res.write(chunk);
        if (typeof res.flush === 'function') res.flush();
      }
      res.end();
    } catch (streamErr) {
      console.error("[server] SSE Stream error:", streamErr);
      res.write(`data: ${JSON.stringify({ error: streamErr.message })}\n\n`);
      if (typeof res.flush === 'function') res.flush();
      res.end();
    }

  } catch (err) {
    console.error("[server] Chat error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// STUDY HUB GENERATOR
// ─────────────────────────────────────────────────────────────

function buildLocalStudyMaterials(materialType, sampleText, count = 20) {
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
    const cardCount = count > 0 ? Math.min(count, 30) : 4;
    for (let i = 0; i < cardCount; i++) {
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
    const questionCount = count > 0 ? count : 20;
    for (let i = 0; i < questionCount; i++) {
      const sentence = finalSentences[i % finalSentences.length];
      quizItems.push({
        question: `Question ${i + 1}: Which statement best reflects the key concept from topic ${(i % finalSentences.length) + 1}?`,
        options: [
          short(sentence, 160),
          "This principle is contradicted by the document.",
          "This statement is outside the scope of this topic.",
          "This concept is unrelated to the core text."
        ],
        correctIndex: 0,
        explanation: "This option is derived directly from the document content."
      });
    }
    return quizItems;
  }

  const milestones = [];
  for (let i = 0; i < 3; i++) {
    const sentence = finalSentences[i % finalSentences.length];
    milestones.push({
      title: `Milestone ${i + 1}: Core Concepts`,
      description: short(sentence, 180),
      tasks: [
        "Read and summarize this section in your study notes.",
        "Highlight core formulas and definitions.",
        "Complete 2 practice questions on this topic."
      ]
    });
  }
  return milestones;
}

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

  if (candidate.startsWith('[') && !candidate.endsWith(']')) {
    const lastObjEnd = candidate.lastIndexOf('}');
    candidate = lastObjEnd !== -1 ? candidate.slice(0, lastObjEnd + 1) + ']' : candidate + ']';
  } else if (candidate.startsWith('{') && !candidate.endsWith('}')) {
    candidate += '}';
  }

  candidate = candidate.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(candidate);
  } catch (err) {
    return JSON.parse(text);
  }
}

app.post("/api/study/generate", async (req, res) => {
  const data = req.body || {};
  const materialType = data.type || "flashcards";
  const filename = data.filename || "";
  const requestedCount = parseInt(data.count, 10);
  const questionCount = !isNaN(requestedCount) && requestedCount > 0 ? requestedCount : (materialType === "quiz" ? 20 : 4);

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
      `Based on the following academic text, generate exactly ${Math.min(questionCount, 20)} high-quality flashcards. ` +
      `Format the output strictly as a JSON array of objects, where each object has 'question' and 'answer' fields. ` +
      `Do not include markdown wrappers, backticks, or conversational filler. Return ONLY valid JSON.\n\nText:\n${sampleText}`
    );
  } else if (materialType === "quiz") {
    prompt = (
      `Based on the following academic text, generate exactly ${questionCount} multiple-choice questions. ` +
      `Format the output strictly as a JSON array of objects, where each object has ` +
      `'question', 'options' (array of 4 strings), 'correctIndex' (0-indexed integer), ` +
      `and 'explanation' fields. ` +
      `Do not include markdown wrappers, backticks, or conversational filler. Return ONLY valid JSON.\n\nText:\n${sampleText}`
    );
  } else if (materialType === "roadmap") {
    prompt = (
      `Based on the following academic text, generate a study roadmap with exactly 3 milestones. ` +
      `Format the output strictly as a JSON array of objects, where each object has ` +
      `'title', 'description', and 'tasks' (array of 3 strings) fields. ` +
      `Do not include markdown wrappers, backticks, or conversational filler. Return ONLY valid JSON.\n\nText:\n${sampleText}`
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
      { role: 'system', content: "You are a JSON generator. You output only raw, valid JSON arrays. Never output markdown code blocks or text outside JSON." },
      { role: 'user', content: prompt }
    ];

    let content = "";
    try {
      const response = await engine.llm.invoke(messages);
      content = (response.content || "").trim();
    } catch (invokeErr) {
      console.warn(`[server] Primary study model error: ${invokeErr.message}. Using document-extracted study materials.`);
      return res.json({ data: buildLocalStudyMaterials(materialType, sampleText, questionCount), fallback: true });
    }

    try {
      const parsedJson = extractAndParseJson(content);
      return res.json({ data: parsedJson });
    } catch (parseErr) {
      console.warn(`[server] JSON parsing failed: ${parseErr.message}. Using document-extracted study materials.`);
      return res.json({ data: buildLocalStudyMaterials(materialType, sampleText, questionCount), fallback: true });
    }

  } catch (err) {
    console.error("[server] Study generation error:", err);
    return res.json({ data: buildLocalStudyMaterials(materialType, sampleText, questionCount), fallback: true });
  }
});

// ─────────────────────────────────────────────────────────────
// HEALTH & OBSERVABILITY METRICS & FRONTEND SERVING
// ─────────────────────────────────────────────────────────────

app.get("/healthz", (req, res) => {
  const summary = metrics.getSummary();
  return res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptime_seconds: summary.uptime_seconds,
    uptime_human: summary.uptime_human,
    model: GLOBAL_STATE.active_chat_model || CHAT_MODEL,
    study_model: GLOBAL_STATE.active_study_model || STUDY_MODEL,
    documents_indexed: GLOBAL_STATE.documents ? GLOBAL_STATE.documents.length : 0,
    active_streams: summary.active_streams,
    memory_mb: summary.memory
  });
});

app.get("/api/metrics", (req, res) => {
  return res.json(metrics.getSummary());
});

app.get("/api/health", (req, res) => {
  const warmupDone = GLOBAL_STATE.warmup_complete || false;
  return res.json({
    status: warmupDone ? "ready" : "warming_up",
    model: GLOBAL_STATE.active_chat_model || CHAT_MODEL,
    study_model: GLOBAL_STATE.active_study_model || STUDY_MODEL,
    requested_chat_model: CHAT_MODEL,
    requested_study_model: STUDY_MODEL,
    warmup_complete: warmupDone,
    chat_engine_ready: GLOBAL_STATE.chat_engine !== null,
    study_engine_ready: GLOBAL_STATE.study_engine !== null,
    documents_count: GLOBAL_STATE.documents.length
  });
});

app.get("*", (req, res) => {
  const target = path.join(STATIC_DIR, req.path);
  if (req.path && req.path !== "/" && fs.existsSync(target) && fs.statSync(target).isFile()) {
    return res.sendFile(target);
  }
  const indexHtml = path.join(STATIC_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) {
    return res.sendFile(indexHtml);
  }
  return res.json({
    message: "AskiFy AI Backend is running.",
    api_health: "/api/health",
    frontend_dev: "http://localhost:5173"
  });
});

async function warmupApp() {
  console.log("Pre-warming AskiFy LLM & Laya decision pipelines...");

  try {
    const engineChat = new RAGEngine(null, CHAT_MODEL);
    GLOBAL_STATE.chat_engine = engineChat;
    console.log(`[Warmup] Chat: Testing '${CHAT_MODEL}'...`);
    const chatTest = await engineChat.llm.invoke("Hello").catch(() => null);
    if (chatTest && chatTest.modelUsed && chatTest.modelUsed !== CHAT_MODEL) {
      console.log(`[Model Auto-Resolver] Requested '${CHAT_MODEL}' is unavailable on this API key. Automatically using '${chatTest.modelUsed}'.`);
      GLOBAL_STATE.active_chat_model = chatTest.modelUsed;
    } else {
      GLOBAL_STATE.active_chat_model = CHAT_MODEL;
      console.log(`[Warmup] Chat: '${CHAT_MODEL}' active and ready.`);
    }
  } catch (err) {
    console.error(`[Warmup] Chat initialization notice:`, err.message);
  }

  try {
    const engineStudy = new RAGEngine(null, STUDY_MODEL);
    GLOBAL_STATE.study_engine = engineStudy;
    console.log(`[Warmup] Study: Testing '${STUDY_MODEL}'...`);
    const studyTest = await engineStudy.llm.invoke("ping").catch(() => null);
    if (studyTest && studyTest.modelUsed && studyTest.modelUsed !== STUDY_MODEL) {
      console.log(`[Model Auto-Resolver] Requested '${STUDY_MODEL}' is unavailable on this API key. Automatically using '${studyTest.modelUsed}'.`);
      GLOBAL_STATE.active_study_model = studyTest.modelUsed;
    } else {
      GLOBAL_STATE.active_study_model = STUDY_MODEL;
      console.log(`[Warmup] Study: '${STUDY_MODEL}' active.`);
    }
  } catch (err) {
    console.error(`[Warmup] Study initialization notice:`, err.message);
  }

  GLOBAL_STATE.warmup_complete = true;
  console.log("[Warmup] Complete.");
}

// ─────────────────────────────────────────────────────────────
// CENTRALIZED PRODUCTION ERROR HANDLER
// ─────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error("[Unhandled Express Exception]", err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(err.status || 500).json({
    error: err.message || "An unexpected academic research engine error occurred.",
    req_id: req.id || null
  });
});

app.listen(port, () => {
  console.log(`\n============================================================`);
  console.log(`🚀  ASKIFY AI BACKEND (Node.js/Express.js & NVIDIA Nemotron 3)`);
  console.log(`============================================================`);
  console.log(`📡 Backend API:     http://127.0.0.1:${port}`);
  console.log(`⚡ Primary Model:   ${CHAT_MODEL}`);
  console.log(`💚 Health Check:    http://127.0.0.1:${port}/healthz`);
  console.log(`📊 Metrics API:     http://127.0.0.1:${port}/api/metrics`);
  console.log(`============================================================\n`);
  
  warmupApp();
});
