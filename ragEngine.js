/**
 * ragEngine.js — RAG Engine & LLM Call Manager (Node.js Port)
 * 
 * Manages queries, LLM fallback chains, local caching, and custom stream pacing.
 */

const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { NVIDIA_API_KEY, CHAT_MODEL, STUDY_MODEL, ALLOWED_MODELS, TEMPERATURE, TOP_P, MAX_TOKENS } = require('./config');
const { sanitizeText } = require('./sanitizer');
const { GLOBAL_STATE } = require('./state');

// Persistent HTTPS Agent — reuses TCP connections to NVIDIA API
// Eliminates ~200-400ms TCP+TLS handshake on every call (biggest TTFT win)
const _httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  maxFreeSockets: 2,
  timeout: 120000,
});

// Axios defaults: use persistent agent for all NVIDIA API calls
axios.defaults.httpsAgent = _httpsAgent;

const SYSTEM_PROMPT = `You are Askify, an expert academic professor and Study Assistant for all subjects of the world. Your purpose is to explain topics across all disciplines (humanities, sciences, engineering, history, medicine, arts, etc.) from an educational and safe standpoint. By default, your language of communication is English.

[SAFETY & CONTRAINTS]
1. TEXTBOOK RESPONSE ONLY: Frame all explanations regarding modern generative technologies (like Image and Video generation models, Diffusion frameworks, or GANs) as high-level architectural overviews or computer science textbook definitions. 
2. NO SENSITIVE EXAMPLES: Do not discuss, generate, or provide actionable instructions for creating specific, sensitive, or harmful digital media. Focus strictly on the underlying math, algorithms, history, or science.
3. BE CONCISE: Provide the direct answer immediately in 3-4 sentences maximum. Use clean markdown bolding (**key terms**) or a short bulleted list for scannability. No introductory fluff.
4. FLEXIBLE ASSISTANT: Use uploaded document context if relevant, but rely on your broad general knowledge when the documents do not cover the user's query.
5. LANGUAGE: Respond in English by default. (Support for other languages will be added in the future).

[VOCABULARY & COMPREHENSION DIRECTIVE - STRICT]
1. Use ONLY Beginner-Level to Medium-Level vocabulary words. 
2. Explicitly BAN all overly complex, advanced academic jargon, archaic terms, and hard words that create reading friction for students.
3. Keep the tone empathetic, encouraging, and highly accessible—explain advanced technical or scientific concepts using simple, real-world analogies.
4. Maintain this simplified vocabulary without compromising mathematical or logical precision.`;

const CASUAL_SYSTEM_PROMPT = `You are Askify, a helpful and friendly AI academic assistant. Respond to the user's conversational message naturally, casually, and briefly (1-2 sentences). Do not use strict markdown academic formatting or bullet points.`;

/**
 * Pre-emptive Image/Video Generation Guard.
 */
function isImageVideoGen(query) {
  const qClean = query.toLowerCase();
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
 * Bulletproof NVIDIA LLM wrapper with multi-tier fallback.
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
          // Adapt LangChain-style SystemMessage / HumanMessage / AIMessage
          const className = m.constructor ? m.constructor.name : '';
          const type = m.type;
          if (className === 'SystemMessage' || type === 'system') {
            role = 'system';
          } else if (className === 'AIMessage' || type === 'ai' || type === 'assistant') {
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
        role: role,
        content: sanitizeText(content)
      };
    });
  }

  _handleModelFailure(model, err) {
    const isRateLimit = err.response && err.response.status === 429;
    const isRateLimitMsg = err.message && (err.message.includes("429") || err.message.toLowerCase().includes("rate limit") || err.message.toLowerCase().includes("too many requests"));
    if (isRateLimit || isRateLimitMsg) {
      if (typeof global.MODEL_COOLDOWNS === "undefined") {
        global.MODEL_COOLDOWNS = {};
      }
      global.MODEL_COOLDOWNS[model] = Date.now() + 60000; // 1 minute cooldown
      console.warn(`[Circuit Breaker] Model ${model} rate-limited (429). Cooldown set for 1 minute.`);
    }
  }

  _getModelChain() {
    const candidates = [this.modelName];
    if (this.modelName === CHAT_MODEL) {
      candidates.push("meta/llama-3.1-8b-instruct", "nvidia/llama-3.1-nemotron-51b-instruct");
    } else if (this.modelName === STUDY_MODEL) {
      candidates.push("meta/llama-3.3-70b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct");
    }

    const now = Date.now();
    const cooldowns = global.MODEL_COOLDOWNS || {};
    const chain = candidates.filter(model => {
      if (cooldowns[model] && now < cooldowns[model]) {
        console.warn(`[_NvidiaLLM] Skipping rate-limited model ${model} (on cooldown)`);
        return false;
      }
      return true;
    });

    return chain.length > 0 ? chain : candidates;
  }

  async _postNvidia(model, payload, isStream = false) {
    if (!NVIDIA_API_KEY || NVIDIA_API_KEY === "your_nvidia_api_key_here") {
      throw new Error("NVIDIA_API_KEY is not configured. Please add your personal NVIDIA API key to the .env file (NVIDIA_API_KEY=nvapi-...). You can get a free key at https://build.nvidia.com");
    }
    const url = "https://integrate.api.nvidia.com/v1/chat/completions";
    try {
      const response = await axios.post(url, payload, {
        headers: {
          "Authorization": `Bearer ${NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": isStream ? "text/event-stream" : "application/json"
        },
        responseType: isStream ? 'stream' : 'json',
        timeout: isStream ? 120000 : 60000
      });
      return response;
    } catch (err) {
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        throw new Error("Invalid or expired NVIDIA_API_KEY. Please verify your key in .env or obtain a fresh key at https://build.nvidia.com");
      }
      if (err.response && err.response.status === 400) {
        let errMsg = "";
        try {
          const body = err.response.data;
          const bodyStr = typeof body === 'object' ? JSON.stringify(body) : String(body);
          if (body && body.error) {
            errMsg = body.error.message || bodyStr;
          } else {
            errMsg = bodyStr;
          }
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
      max_tokens: Math.min(MAX_TOKENS, 2048),
      top_p: TOP_P,
      stream: false
    };

    const resp = await this._postNvidia(model, payload, false);
    const content = resp.data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`Empty content from ${model}`);
    }
    return content;
  }

  async * _streamCall(model, messages) {
    const payload = {
      model,
      messages: this._buildMessages(messages),
      temperature: TEMPERATURE,
      max_tokens: Math.min(MAX_TOKENS, 2048),
      top_p: TOP_P,
      stream: true
    };

    const resp = await this._postNvidia(model, payload, true);
    const stream = resp.data;

    let buffer = "";
    for await (const chunk of stream) {
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
              if (["safety", "moderation", "policy", "flagged", "safety guidelines"].some(kw => errMsgLower.includes(kw))) {
                throw new Error("CONTENT_SAFETY_ERROR");
              }
              throw new Error(parsed.error.message || JSON.stringify(parsed.error));
            }
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) {
              yield token;
            }
          } catch (e) {
            if (e.message === "CONTENT_SAFETY_ERROR") {
              throw e;
            }
          }
        }
      }
    }
  }

  async invoke(messages) {
    let lastError = null;
    for (const model of this._getModelChain()) {
      try {
        const content = await this._nonStreamCall(model, messages);
        return { content };
      } catch (err) {
        this._handleModelFailure(model, err);
        lastError = err;
      }
    }
    throw lastError || new Error("LLM invoke failed for all models in the chain");
  }

  async * stream(messages) {
    let lastError = null;
    for (const model of this._getModelChain()) {
      try {
        for await (const token of this._streamCall(model, messages)) {
          yield token;
        }
        return;
      } catch (err) {
        this._handleModelFailure(model, err);
        lastError = err;

        // Skip non-stream fallback of the same model if it is a rate limit or network issue
        const isRateLimit = err.response && err.response.status === 429;
        const isRateLimitMsg = err.message && (err.message.includes("429") || err.message.toLowerCase().includes("rate limit") || err.message.toLowerCase().includes("too many requests"));
        if (isRateLimit || isRateLimitMsg) {
          console.warn(`[_NvidiaLLM] Skipping non-stream invoke fallback for ${model} due to rate limiting. Trying next model...`);
          continue;
        }

        console.warn(`[_NvidiaLLM] Stream failed for ${model}: ${err.message}. Trying non-stream invoke...`);
        try {
          const content = await this._nonStreamCall(model, messages);
          const chunkSize = 15;
          for (let i = 0; i < content.length; i += chunkSize) {
            yield content.slice(i, i + chunkSize);
          }
          return;
        } catch (err2) {
          this._handleModelFailure(model, err2);
          console.warn(`[_NvidiaLLM] Invoke failed for ${model}: ${err2.message}. Trying next model...`);
          lastError = err2;
        }
      }
    }
    throw lastError || new Error("LLM stream failed for all models in the chain");
  }
}

/**
 * NVIDIA-only RAG engine with streaming.
 */
class RAGEngine {
  constructor(vectorStore, modelName = null) {
    this._vectorStore = vectorStore;
    this.modelName = modelName || CHAT_MODEL;
    this.llm = new _NvidiaLLM(this.modelName);
    this.history = []; // Array of { role: 'user'|'assistant', content: string }
    this.cacheFile = "query_cache.json";
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
        // Silent ignore cache errors
      }
    }
  }

  _saveCache() {
    // Non-blocking async write — never stall the event loop
    setImmediate(() => {
      try {
        fs.writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2), 'utf8');
      } catch (err) {
        // Silent ignore write errors
      }
    });
  }

  detectIntent(query) {
    const q = query.toLowerCase();
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

  async * streamGenerateResponse(query, prewarmedDocs = null) {
    const cleanQuery = query.trim().toLowerCase().replace(/\?/g, '').trim();

    // IMAGE/VIDEO GENERATION GUARD
    if (isImageVideoGen(cleanQuery)) {
      const fallbackMsg = (
        "⚠️ **Content Warning**\n\n" +
        "Your request was flagged by content safety filters. " +
        "Please rephrase your query to be respectful and study-focused."
      );
      yield `data: ${JSON.stringify({ token: '**Answer:**  \n' })}\n\n`;
      yield `data: ${JSON.stringify({ token: fallbackMsg })}\n\n`;
      yield `data: ${JSON.stringify({ intent: 'topic_explanation', sources: [], done: true })}\n\n`;
      return;
    }

    // TIER 1: STRICT GREETINGS
    if (['hi', 'hii', 'hiii', 'hello', 'hey', 'yo'].includes(cleanQuery)) {
      const ans = "How can I help you today?";
      yield `data: ${JSON.stringify({ token: '**Answer:**  \n' })}\n\n`;
      yield `data: ${JSON.stringify({ token: ans })}\n\n`;
      yield `data: ${JSON.stringify({ intent: 'topic_explanation', done: true })}\n\n`;
      this.history.push({ role: 'user', content: query });
      this.history.push({ role: 'assistant', content: ans });
      if (this.history.length > 12) {
        this.history = this.history.slice(-12);
      }
      return;
    }

    // TIER 2: CASUAL QUESTIONS
    if (['how are you', 'how r u', 'whats up', 'who are you'].includes(cleanQuery)) {
      yield `data: ${JSON.stringify({ token: '**Answer:**  \n' })}\n\n`;
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
        fullAnswer = "I'm doing great, thank you for asking! How can I assist you with your studies today?";
        yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
      }

      yield `data: ${JSON.stringify({ intent: 'topic_explanation', done: true })}\n\n`;
      this.history.push({ role: 'user', content: query });
      this.history.push({ role: 'assistant', content: fullAnswer });
      if (this.history.length > 12) {
        this.history = this.history.slice(-12);
      }
      return;
    }

    // TIER 3: ACADEMIC / DOCUMENT QUERIES
    // Cache check
    if (this.cache[cleanQuery]) {
      const cached = this.cache[cleanQuery];
      yield `data: ${JSON.stringify({ token: '**Answer:**  \n' })}\n\n`;
      yield `data: ${JSON.stringify({ token: cached.answer })}\n\n`;
      yield `data: ${JSON.stringify({ intent: cached.intent || 'topic_explanation', done: true })}\n\n`;
      this.history.push({ role: 'user', content: query });
      this.history.push({ role: 'assistant', content: cached.answer });
      return;
    }

    yield `data: ${JSON.stringify({ token: '**Answer:**  \n' })}\n\n`;

    try {
      let contextDocs = null;
      const documents = GLOBAL_STATE.documents || [];

      if (documents.length > 0) {
        if (prewarmedDocs) {
          contextDocs = prewarmedDocs;
        } else if (this._vectorStore) {
          try {
            // Find semantic similarity chunks
            const scoredDocs = [];
            const qEmbs = await this._vectorStore.embeddings ? await embedTexts([query], 'query') : [];
            if (qEmbs.length > 0) {
              const qEmb = qEmbs[0];
              for (const doc of this._vectorStore.docs) {
                const docEmb = doc.metadata && doc.metadata.embedding;
                if (docEmb) {
                  let sim = 0;
                  const minLen = Math.min(qEmb.length, docEmb.length);
                  for (let i = 0; i < minLen; i++) {
                    sim += qEmb[i] * docEmb[i];
                  }
                  if (sim >= 0.65) {
                    scoredDocs.push({ sim, doc });
                  }
                }
              }
            }
            scoredDocs.sort((a, b) => b.sim - a.sim);
            contextDocs = scoredDocs.slice(0, 2).map(x => x.doc);
          } catch (err) {
            contextDocs = [];
          }
        }
      }

      let contextText = "";
      if (contextDocs && contextDocs.length > 0) {
        contextText = contextDocs.map(doc => doc.pageContent.slice(0, 1400)).join("\n\n");
      }

      let systemContent = SYSTEM_PROMPT;
      if (contextText) {
        systemContent += `\n\nUse this retrieved context first:\n${contextText}`;
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
        const isSafety = errMsg.includes("CONTENT_SAFETY_ERROR") || ["content safety", "safety warning", "safety policy", "moderation"].some(kw => errMsg.toLowerCase().includes(kw));

        if (isSafety) {
          fullAnswer = (
            "⚠️ **Content Warning**\n\n" +
            "Your request was flagged by content safety filters. " +
            "Please rephrase your query to be respectful and study-focused."
          );
          yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
        } else if (contextText) {
          fullAnswer = `**Response based on your documents:**\n\n${contextText.slice(0, 2000)}`;
          yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
        } else {
          fullAnswer = (
            "⚠️ **Connection Issue**\n\n" +
            `\`${err.name || 'Error'}: ${errMsg.slice(0, 200)}\`\n\n` +
            "📌 Wait a moment and retry\n" +
            "📌 Check your connection"
          );
          yield `data: ${JSON.stringify({ token: fullAnswer })}\n\n`;
        }
      }

      const cleanAnswer = fullAnswer.trim();
      const intent = this.detectIntent(query);

      const isFallback = (
        !cleanAnswer ||
        ["brief connection delay", "upload study documents", "ready to help", "temporary issue connecting", "image-like content", "connection issue"].some(kw => cleanAnswer.toLowerCase().includes(kw))
      );

      if (!isFallback) {
        this.cache[cleanQuery] = { answer: cleanAnswer, intent };
        this._saveCache();
      }

      this.history.push({ role: 'user', content: query });
      this.history.push({ role: 'assistant', content: cleanAnswer });
      if (this.history.length > 12) {
        this.history = this.history.slice(-12);
      }

      yield `data: ${JSON.stringify({ intent, done: true })}\n\n`;

    } catch (err) {
      console.error("[RAG Engine Fatal]", err);
      yield `data: ${JSON.stringify({ error: err.message || String(err) })}\n\n`;
    }
  }

  clearHistory() {
    this.history = [];
  }
}

module.exports = {
  RAGEngine,
  _NvidiaLLM,
  isImageVideoGen,
  CASUAL_SYSTEM_PROMPT
};
