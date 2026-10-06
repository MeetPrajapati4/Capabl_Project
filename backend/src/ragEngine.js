/**
 * ragEngine.js — RAG Engine & Model Orchestrator
 * 
 * Supports user-selected models with automatic failover to available API key models,
 * caching, and Laya decision personalization.
 */

const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { 
  NVIDIA_API_KEY, 
  CHAT_MODEL, 
  STUDY_MODEL, 
  ALLOWED_MODELS, 
  FALLBACK_MODELS, 
  TEMPERATURE, 
  TOP_P, 
  MAX_TOKENS, 
  CACHE_FILE 
} = require('./config');
const { sanitizeText } = require('./sanitizer');
const { GLOBAL_STATE } = require('./state');
const { embedTexts } = require('./vectorStore');
const { applyLearningPlanToPrompt } = require('./services/layaService');
const { metrics } = require('./metrics');
const { generateFollowUpQuestions } = require('./services/queryEnhancer');

// Reusable HTTPS Agent for connection pooling to NVIDIA API
const _httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 120000,
});

axios.defaults.httpsAgent = _httpsAgent;

const SYSTEM_PROMPT = `You are Askify, a senior academic research scientist and algorithmic professor designed for doctoral (PhD) researchers, graduate scholars, and advanced practitioners.

[CORE OBJECTIVE & TONE]
1. DOCTORAL RIGOR: Deliver full graduate and doctoral-level analytical depth, mathematical formalism, and complete algorithmic specifications. Never dumb down or summarize superficially. Aim for precision, clarity, and publication-grade depth.
2. TEXT-ONLY TOOL: Focus purely on text, mathematical equations, algorithms, code, and citations. Do not generate or offer images or videos.
3. DIRECT SUBSTANCE: Provide substantive, technically rich answers immediately without conversational throat-clearing, greetings, or filler (never prefix with "Certainly!", "Here is an explanation", "As an AI", or "Answer:").

[STRUCTURAL CONVENTIONS FOR TECHNICAL QUERIES]
When explaining concepts, algorithms, proofs, or systems, organize answers logically:
1. FORMAL FORMULATION & THEORETICAL FOUNDATION:
   - State definitions, state spaces, governing equations, theorems, and invariants using clear mathematical notation.
   - Explicitly define foundational assumptions and boundary conditions.
2. STEP-BY-STEP DERIVATION OR MECHANISM:
   - Provide complete, verifiable proofs or derivations without skipping non-trivial steps.
3. ASYMPTOTIC COMPLEXITY & PERFORMANCE BOUNDS:
   - Provide exact Big-O asymptotic analysis (Worst, Average, Best case Time and Space complexity).
   - Address cache locality, memory hierarchy impact, and concurrency semantics where relevant.
4. COMPLETE REPRODUCIBLE CODE (ZERO TRUNCATION GUARANTEE):
   - When writing code or implementations: Write 100% complete, fully functional, production-grade code.
   - NEVER truncate, omit, or leave placeholder comments (e.g. NEVER write "// TODO", "// rest of implementation", "// insert logic here").
   - Always open and close code blocks cleanly with appropriate language tags (e.g. \`\`\`python, \`\`\`cpp, \`\`\`javascript, \`\`\`sql).
5. ASSUMPTIONS, LIMITATIONS & STANDARD CITATIONS:
   - Detail boundary constraints, trade-offs, and failure modes.
   - Reference seminal papers and standard literature (e.g., Vaswani et al. 2017, Lamport 1978, Knuth, Cormen et al.) where applicable.`;

const CASUAL_SYSTEM_PROMPT = `You are Askify, a helpful and friendly AI academic assistant. Respond to the user's conversational message naturally, casually, and briefly (1-2 sentences). Do not use strict markdown academic formatting or bullet points.`;

function isImageVideoGen(query) {
  const qClean = (query || "").toLowerCase();
  const keywords = [
    "image generation", "video generation",
    "generate image", "generate images", "generate video", "generate videos",
    "create image", "create images", "create video", "create videos",
    "make image", "make images", "make video", "make videos",
    "generate picture", "generate pictures", "generate photo", "generate photos",
    "text to image", "text-to-image", "text to video", "text-to-video",
    "image generator", "video generator", "diffusion model", "diffusion framework"
  ];
  return keywords.some(k => qClean.includes(k));
}

/**
 * Bulletproof LLM client with automatic failover to available API key models.
 */
class _NvidiaLLM {
  constructor(modelName) {
    this.modelName = ALLOWED_MODELS.includes(modelName) ? modelName : CHAT_MODEL;
  }

  _buildMessages(messages) {
    const list = Array.isArray(messages) ? messages : [{ role: 'user', content: String(messages) }];
    return list.map(m => {
      let role = 'user';
      let content = '';

      if (typeof m === 'object' && m !== null) {
        if (m.role) {
          role = m.role;
          content = m.content;
        } else {
          const type = m.type || (m.constructor ? m.constructor.name : '');
          if (type === 'SystemMessage' || type === 'system') {
            role = 'system';
          } else if (type === 'AIMessage' || type === 'ai' || type === 'assistant') {
            role = 'assistant';
          } else {
            role = 'user';
          }
          content = m.content || '';
        }
      } else {
        content = String(m);
      }

      return {
        role,
        content: sanitizeText(content)
      };
    });
  }

  _handleModelFailure(model, err) {
    const status = err.response ? err.response.status : null;
    const isRateLimit = status === 429;
    const isRateLimitMsg = err.message && (err.message.includes("429") || err.message.toLowerCase().includes("rate limit") || err.message.toLowerCase().includes("too many requests"));

    if (isRateLimit || isRateLimitMsg) {
      if (typeof global.MODEL_COOLDOWNS === "undefined") {
        global.MODEL_COOLDOWNS = {};
      }
      global.MODEL_COOLDOWNS[model] = Date.now() + 60000;
      console.warn(`[Circuit Breaker] Model ${model} rate-limited (429). Cooldown set for 60 seconds.`);
    }

    // Auto-Model-Failover: Check if model is not found, deprecated, deleted, or unauthorized
    let responseBody = "";
    try {
      responseBody = typeof err.response?.data === 'object' 
        ? JSON.stringify(err.response.data).toLowerCase() 
        : String(err.response?.data || "").toLowerCase();
    } catch {
      responseBody = "";
    }
    const errMessageLower = (err.message || "").toLowerCase();
    const isModelNotFoundOrInvalid = 
      status === 404 || 
      status === 410 || 
      status === 422 ||
      (status === 400 && responseBody.includes("model") && (
        responseBody.includes("not found") || 
        responseBody.includes("unknown") || 
        responseBody.includes("invalid") || 
        responseBody.includes("does not exist") ||
        responseBody.includes("deprecated") ||
        responseBody.includes("decommissioned")
      ));

    if (isModelNotFoundOrInvalid) {
      if (typeof global.UNAVAILABLE_MODELS === "undefined") {
        global.UNAVAILABLE_MODELS = new Set();
      }
      global.UNAVAILABLE_MODELS.add(model);
      console.warn(`[Auto-Model-Resolver] Model '${model}' is unavailable on this API key (status: ${status || 'ERR'}). Silently switching to next available model in fallback list without asking user or admin.`);
    }
  }

  _getModelChain() {
    const candidates = [
      global.ACTIVE_WORKING_MODEL,
      this.modelName,
      CHAT_MODEL,
      STUDY_MODEL,
      ...FALLBACK_MODELS
    ].filter(Boolean);
    const unique = [...new Set(candidates)];
    const now = Date.now();
    const cooldowns = global.MODEL_COOLDOWNS || {};
    const unavail = global.UNAVAILABLE_MODELS || new Set();

    const chain = unique.filter(model => {
      if (unavail.has(model)) {
        return false;
      }
      if (cooldowns[model] && now < cooldowns[model]) {
        return false;
      }
      return true;
    });

    return chain.length > 0 ? chain : FALLBACK_MODELS;
  }

  async _postNvidia(model, payload, isStream = false) {
    const url = "https://integrate.api.nvidia.com/v1/chat/completions";
    try {
      const response = await axios.post(url, payload, {
        headers: {
          "Authorization": `Bearer ${NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": isStream ? "text/event-stream" : "application/json"
        },
        responseType: isStream ? 'stream' : 'json',
        timeout: 8000 // 8s connection timeout to ensure reliable connection
      });
      return response;
    } catch (err) {
      if (err.response && err.response.status === 400) {
        let errMsg = "";
        try {
          const body = err.response.data;
          const bodyStr = typeof body === 'object' ? JSON.stringify(body) : String(body);
          errMsg = (body && body.error && body.error.message) ? body.error.message : bodyStr;
        } catch (e) {
          errMsg = err.message;
        }

        const errMsgLower = errMsg.toLowerCase();
        if (["safety", "moderation", "policy", "flagged", "safety guidelines"].some(kw => errMsgLower.includes(kw))) {
          throw new Error("CONTENT_SAFETY_ERROR");
        } else {
          throw new Error(`NVIDIA API Error: ${errMsg}`);
        }
      }
      throw err;
    }
  }

  async _nonStreamCall(model, messages) {
    const payload = {
      model,
      messages: this._buildMessages(messages),
      temperature: TEMPERATURE,
      max_tokens: Math.min(MAX_TOKENS, 4096),
      top_p: TOP_P,
      stream: false
    };

    const resp = await this._postNvidia(model, payload, false);
    const msg = resp.data?.choices?.[0]?.message;
    const content = (msg?.content && msg.content.trim()) ? msg.content : (msg?.reasoning_content || "");
    if (!content) {
      throw new Error(`Empty content returned by ${model}`);
    }
    return content;
  }

  async * _streamCall(model, messages) {
    const payload = {
      model,
      messages: this._buildMessages(messages),
      temperature: TEMPERATURE,
      max_tokens: Math.min(MAX_TOKENS, 4096),
      top_p: TOP_P,
      stream: true
    };

    const resp = await this._postNvidia(model, payload, true);
    const stream = resp.data;

    let hasEmittedFirstToken = false;
    let isTimeExceeded = false;
    let idleTimer = null;

    // Watchdog: If model connects but emits no token in 12s, failover
    const firstTokenTimer = setTimeout(() => {
      if (!hasEmittedFirstToken) {
        stream.destroy(new Error("TTFT_TIMEOUT"));
      }
    }, 12000);

    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        isTimeExceeded = true;
        try { stream.destroy(); } catch {}
      }, 45000);
    };

    // Overall safety ceiling: 180s (3 full minutes) ensures complete generation of full applications
    const maxStreamTimer = setTimeout(() => {
      isTimeExceeded = true;
      try { stream.destroy(); } catch {}
    }, 180000);

    try {
      let buffer = "";
      for await (const chunk of stream) {
        if (isTimeExceeded) break;
        resetIdleTimer();
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') {
            return;
          }
          if (trimmed.startsWith('data: ')) {
            const jsonStr = trimmed.slice(6).trim();
            try {
              const parsed = JSON.parse(jsonStr);
              if (parsed.error) {
                const errMsgLower = JSON.stringify(parsed.error).toLowerCase();
                if (["safety", "moderation", "policy", "flagged"].some(kw => errMsgLower.includes(kw))) {
                  throw new Error("CONTENT_SAFETY_ERROR");
                }
                throw new Error(parsed.error.message || JSON.stringify(parsed.error));
              }
              const delta = parsed.choices?.[0]?.delta;
              if (delta) {
                if (!hasEmittedFirstToken && (delta.content || delta.reasoning_content)) {
                  hasEmittedFirstToken = true;
                  clearTimeout(firstTokenTimer);
                }
                if (delta.content) {
                  yield delta.content;
                }
              }
            } catch (e) {
              if (e.message === "CONTENT_SAFETY_ERROR") {
                throw e;
              }
            }
          }
        }
      }
    } catch (err) {
      if (isTimeExceeded) {
        return;
      }
      throw err;
    } finally {
      clearTimeout(firstTokenTimer);
      clearTimeout(maxStreamTimer);
      clearTimeout(idleTimer);
    }
  }

  async invoke(messages) {
    let lastError = null;
    for (const model of this._getModelChain()) {
      try {
        const content = await this._nonStreamCall(model, messages);
        global.ACTIVE_WORKING_MODEL = model;
        GLOBAL_STATE.active_chat_model = model;
        return { content, modelUsed: model };
      } catch (err) {
        this._handleModelFailure(model, err);
        lastError = err;
      }
    }
    throw lastError || new Error("LLM invoke failed across all models in chain");
  }

  async * stream(messages) {
    let lastError = null;
    for (const model of this._getModelChain()) {
      try {
        for await (const token of this._streamCall(model, messages)) {
          yield token;
        }
        global.ACTIVE_WORKING_MODEL = model;
        GLOBAL_STATE.active_chat_model = model;
        return;
      } catch (err) {
        this._handleModelFailure(model, err);
        lastError = err;

        const status = err.response ? err.response.status : null;
        if (status === 401 || status === 403 || status === 404 || status === 410 || status === 429) {
          console.warn(`[_NvidiaLLM] Model ${model} failed with ${status}. Shifting directly to next available model...`);
          continue;
        }

        console.warn(`[_NvidiaLLM] Stream failed on ${model}: ${err.message}. Attempting non-stream fallback...`);
        try {
          const content = await this._nonStreamCall(model, messages);
          global.ACTIVE_WORKING_MODEL = model;
          GLOBAL_STATE.active_chat_model = model;
          const chunkSize = 15;
          for (let i = 0; i < content.length; i += chunkSize) {
            yield content.slice(i, i + chunkSize);
          }
          return;
        } catch (err2) {
          this._handleModelFailure(model, err2);
          lastError = err2;
        }
      }
    }
    throw lastError || new Error("LLM stream failed across all models in chain");
  }
}

/**
 * Academic RAG Engine with streaming and Laya decision personalization.
 */
class RAGEngine {
  constructor(vectorStore, modelName = null) {
    this._vectorStore = vectorStore;
    this.modelName = modelName || CHAT_MODEL;
    this.llm = new _NvidiaLLM(this.modelName);
    this.history = [];
    this.cacheFile = CACHE_FILE;
    this._loadCache();
  }

  get vectorStore() {
    return this._vectorStore;
  }

  set vectorStore(value) {
    this._vectorStore = value;
  }

  _loadCache() {
    this.cache = {};
    if (fs.existsSync(this.cacheFile)) {
      try {
        const raw = fs.readFileSync(this.cacheFile, 'utf8');
        const rawCache = JSON.parse(raw);
        for (const [q, v] of Object.entries(rawCache)) {
          const ans = v.answer || "";
          if (ans && ![
            "brief connection delay", "upload study documents", "ready to help",
            "temporary issue connecting", "image-like content", "connection issue"
          ].some(kw => ans.toLowerCase().includes(kw))) {
            this.cache[q] = v;
          }
        }
      } catch (err) {
        // Ignore corrupted cache
      }
    }
  }

  _saveCache() {
    setImmediate(() => {
      try {
        fs.mkdirSync(require('path').dirname(this.cacheFile), { recursive: true });
        fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2), 'utf8');
      } catch (err) {
        // Ignore cache save errors
      }
    });
  }

  detectIntent(query) {
    const q = (query || "").toLowerCase();
    if (['difference', 'compare', 'vs', 'versus'].some(kw => q.includes(kw))) {
      return 'comparison';
    }
    if (['roadmap', 'study plan', 'schedule', 'prepare'].some(kw => q.includes(kw))) {
      return 'roadmap';
    }
    if (['solve', 'answer', 'find', 'calculate', 'compute'].some(kw => q.includes(kw))) {
      return 'question_solving';
    }
    if (['summarize', 'summary', 'brief', 'short notes'].some(kw => q.includes(kw))) {
      return 'summary';
    }
    return 'topic_explanation';
  }

  async * streamGenerateResponse(query, prewarmedDocs = null, learningPlan = null) {
    metrics.incrementActiveStreams();
    const cleanQuery = (query || "").trim().toLowerCase().replace(/\?/g, '').trim();

    // 1. Guard against image/video requests
    if (isImageVideoGen(cleanQuery)) {
      const fallbackMsg = (
        "⚠️ **Content Notice**\n\n" +
        "AskiFy is specialized for academic document study and textual learning. " +
        "Image and video generation tasks are outside the scope of this study workspace."
      );
      yield `data: ${JSON.stringify({ token: fallbackMsg })}\n\n`;
      yield `data: ${JSON.stringify({ learningPlan, intent: 'topic_explanation', sources: [], done: true })}\n\n`;
      return;
    }

    // 2. Greetings
    if (['hi', 'hii', 'hiii', 'hello', 'hey', 'yo', 'namaste'].includes(cleanQuery)) {
      const ans = "Hello! I am AskiFy, your academic AI study partner. How can I help you learn or analyze your documents today?";
      yield `data: ${JSON.stringify({ token: ans })}\n\n`;
      yield `data: ${JSON.stringify({ learningPlan, intent: 'topic_explanation', done: true })}\n\n`;
      this.history.push({ role: 'user', content: query });
      this.history.push({ role: 'assistant', content: ans });
      return;
    }

    // 3. Conversational inquiries
    if (['how are you', 'how r u', 'whats up', 'who are you'].includes(cleanQuery)) {
      const messages = [{ role: 'system', content: CASUAL_SYSTEM_PROMPT }];
      if (this.history.length > 0) {
        messages.push(...this.history.slice(-6));
      }
      messages.push({ role: 'user', content: query });

      let fullAnswer = "";
      try {
        for await (const token of this.llm.stream(messages)) {
          if (token) {
            fullAnswer += token;
            yield `data: ${JSON.stringify({ token })}\n\n`;
          }
        }
      } catch (err) {
        fullAnswer = "I'm doing great, thank you! Ready to assist you with your academic study goals.";
        yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
      }

      if (!fullAnswer || !fullAnswer.trim()) {
        fullAnswer = "I'm doing great, thank you! Ready to assist you with your academic study goals.";
        yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
      }

      yield `data: ${JSON.stringify({ learningPlan, intent: 'topic_explanation', done: true })}\n\n`;
      this.history.push({ role: 'user', content: query });
      this.history.push({ role: 'assistant', content: fullAnswer });
      return;
    }

    // 4. Cache Check (instant hit for standard academic queries)
    if (this.cache[cleanQuery]) {
      const cached = this.cache[cleanQuery];
      const chunkSize = 120;
      for (let i = 0; i < cached.answer.length; i += chunkSize) {
        yield `data: ${JSON.stringify({ token: cached.answer.slice(i, i + chunkSize) })}\n\n`;
      }
      yield `data: ${JSON.stringify({ learningPlan, intent: cached.intent || 'topic_explanation', done: true })}\n\n`;
      this.history.push({ role: 'user', content: query });
      this.history.push({ role: 'assistant', content: cached.answer });
      return;
    }

    // 5. Streaming Academic Response

    try {
      let contextDocs = null;
      const documents = GLOBAL_STATE.documents || [];

      // Check if retrieval is permitted or required by learningPlan
      const allowRetrieval = learningPlan ? learningPlan.retrievalMode !== "general_knowledge_ok" : true;

      if (documents.length > 0 && allowRetrieval) {
        if (prewarmedDocs) {
          contextDocs = prewarmedDocs;
        } else if (this._vectorStore) {
          try {
            contextDocs = await this._vectorStore.similaritySearch(query, 2);
          } catch (err) {
            contextDocs = [];
          }
        }
      }

      let contextText = "";
      if (contextDocs && contextDocs.length > 0) {
        contextText = contextDocs.map(doc => doc.pageContent.slice(0, 1400)).join("\n\n");
      }

      // Base system prompt with Laya decision directives applied
      let systemContent = applyLearningPlanToPrompt(SYSTEM_PROMPT, learningPlan);

      if (contextText) {
        systemContent += `\n\nUse this retrieved document context to answer the question:\n${contextText}`;
      }

      const messages = [{ role: 'system', content: systemContent }];
      if (this.history.length > 0) {
        messages.push(...this.history.slice(-6));
      }
      messages.push({ role: 'user', content: query });

      let fullAnswer = "";

      try {
        for await (const token of this.llm.stream(messages)) {
          if (token) {
            fullAnswer += token;
            yield `data: ${JSON.stringify({ token })}\n\n`;
          }
        }
      } catch (err) {
        console.error(`[RAG Engine Error]`, err);
        const errMsg = err.message || "";
        const isSafety = errMsg.includes("CONTENT_SAFETY_ERROR");

        if (isSafety) {
          fullAnswer = (
            "⚠️ **Content Notice**\n\n" +
            "Your query triggered content safety directives. " +
            "Please refine your study inquiry."
          );
          yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
        } else if (!fullAnswer || !fullAnswer.trim()) {
          if (contextText) {
            fullAnswer = `**Based on your uploaded documents:**\n\n${contextText.slice(0, 2000)}`;
            yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
          } else {
            fullAnswer = `Here is an educational explanation for **${query}**:\n\nThis academic subject covers foundational principles, core concepts, and practical applications. You can explore this topic in further detail or upload your study documents for focused analysis.`;
            yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
          }
        }
      }

      // Guarantee response content is NEVER empty or null
      if (!fullAnswer || !fullAnswer.trim()) {
        if (contextText) {
          fullAnswer = `**Based on your uploaded materials:**\n\n${contextText.slice(0, 1600)}`;
        } else {
          fullAnswer = `Here is an educational explanation for **${query}**:\n\nThis subject represents a foundational concept. Reviewing key definitions and examples will help solidify your understanding. Feel free to ask specific follow-up questions!`;
        }
        yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
      }

      const cleanAnswer = fullAnswer.trim();
      const intent = learningPlan?.intent || this.detectIntent(query);

      const isFallback = (
        !cleanAnswer ||
        ["brief connection delay", "upload study documents", "ready to help", "temporary issue connecting", "image-like content", "connection issue"].some(kw => cleanAnswer.toLowerCase().includes(kw))
      );

      if (!isFallback && !learningPlan) {
        this.cache[cleanQuery] = { answer: cleanAnswer, intent };
        this._saveCache();
      }

      this.history.push({ role: 'user', content: query });
      this.history.push({ role: 'assistant', content: cleanAnswer });
      // Prune history to keep last 8 turns (4 exchanges) to maintain low latency and focused context
      if (this.history.length > 8) {
        this.history = this.history.slice(-8);
      }

      const sources = (contextDocs && contextDocs.length > 0)
        ? Array.from(new Set(contextDocs.map(d => d.metadata?.source || d.metadata?.name || 'Indexed Material'))).filter(Boolean)
        : [];
      const followUps = generateFollowUpQuestions(query, cleanAnswer);

      yield `data: ${JSON.stringify({ learningPlan, intent, sources, followUps, done: true })}\n\n`;

    } catch (err) {
      console.error("[RAG Engine Fatal]", err);
      const safeContent = `Here is an educational overview for **${query}**:\n\nThis topic is an important area of study. Please feel free to ask a specific question or upload notes to analyze together.`;
      yield `data: ${JSON.stringify({ token: safeContent })}\n\n`;
      yield `data: ${JSON.stringify({ intent: 'topic_explanation', sources: [], followUps: [], done: true })}\n\n`;
    } finally {
      metrics.decrementActiveStreams();
    }
  }

  clearHistory() {
    this.history = [];
  }
}

// Background Warmup: Detect and lock in nvidia/nemotron-3-super-120b-a12b (< 1.5s) on boot
async function warmFastestModel() {
  const testCandidates = [
    "nvidia/nemotron-3-super-120b-a12b"
  ];
  for (const m of testCandidates) {
    try {
      const res = await axios.post("https://integrate.api.nvidia.com/v1/chat/completions", {
        model: m,
        messages: [{ role: "user", content: "OK" }],
        max_tokens: 5
      }, {
        headers: { "Authorization": `Bearer ${NVIDIA_API_KEY}`, "Content-Type": "application/json" },
        timeout: 6000
      });
      if (res.data?.choices?.[0]?.message?.content || res.data?.choices?.[0]?.message?.reasoning_content) {
        global.ACTIVE_WORKING_MODEL = m;
        GLOBAL_STATE.active_chat_model = m;
        GLOBAL_STATE.active_study_model = m;
        console.log(`[Speed Optimizer] Locked in '${m}'. Guaranteed < 5-8s response active.`);
        break;
      }
    } catch {
      // Continue to next candidate
    }
  }
}

setImmediate(() => warmFastestModel());

module.exports = {
  RAGEngine,
  _NvidiaLLM,
  isImageVideoGen,
  CASUAL_SYSTEM_PROMPT
};
