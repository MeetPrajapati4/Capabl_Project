/**
 * vectorStore.js — In-Memory Vector Store & Cloud Embeddings
 * 
 * Uses NVIDIA Nemotron embeddings with fast cosine similarity search.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { NVIDIA_API_KEY, CHUNK_SIZE, CHUNK_OVERLAP, TOP_K, VECTOR_STORE_FILE } = require('./config');
const { RecursiveCharacterTextSplitter } = require('./documentProcessor');

const EMBEDDING_MODELS = [
  'nvidia/llama-nemotron-embed-vl-1b-v2',
  'nvidia/nemotron-3-embed-1b'
];

/**
 * Compute embeddings for an array of texts with multi-tier fallback.
 */
async function embedTexts(texts, inputType = 'passage') {
  if (!texts || texts.length === 0) return [];

  const batchSize = 50;
  const vectors = [];
  if (!NVIDIA_API_KEY || NVIDIA_API_KEY === "your_nvidia_api_key_here") {
    throw new Error("NVIDIA_API_KEY is not configured. Please add your personal NVIDIA API key to the .env file (NVIDIA_API_KEY=nvapi-...). You can obtain a free key with 1,000 credits at https://build.nvidia.com");
  }

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    let batchVectors = null;
    let lastError = null;

    for (const model of EMBEDDING_MODELS) {
      try {
        const response = await axios.post(
          'https://integrate.api.nvidia.com/v1/embeddings',
          {
            input: batch,
            model: model,
            input_type: inputType
          },
          {
            headers: {
              'Authorization': `Bearer ${NVIDIA_API_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );

        const responseData = response.data;
        if (responseData && responseData.data) {
          batchVectors = responseData.data
            .sort((a, b) => a.index - b.index)
            .map(item => item.embedding);
          break;
        }
      } catch (err) {
        lastError = err;
        console.warn(`[vectorStore] Embedding model ${model} failed: ${err.message}. Trying next fallback...`);
      }
    }

    if (!batchVectors) {
      console.error(`[vectorStore] All embedding models failed. Generating deterministic fallback embeddings.`);
      // Deterministic fallback vector of size 2048 to prevent crashes
      batchVectors = batch.map(text => {
        const v = new Array(2048).fill(0);
        let hash = 0;
        for (let c = 0; c < text.length; c++) {
          hash = (hash * 31 + text.charCodeAt(c)) & 0xffffffff;
          v[Math.abs(hash) % 2048] += 1;
        }
        // Normalize
        const norm = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0)) || 1;
        return v.map(val => val / norm);
      });
    }

    vectors.push(...batchVectors);
  }

  return vectors;
}

/**
 * Lightweight, high-performance in-memory vector store.
 */
class CloudVectorStore {
  constructor(docs = []) {
    // docs is an array of: { pageContent, metadata: { source, page, chunk_index, embedding } }
    this.docs = docs;
  }

  async similaritySearch(query, k = 3) {
    if (!this.docs || this.docs.length === 0) {
      return [];
    }

    try {
      const qEmbs = await embedTexts([query], 'query');
      if (!qEmbs || qEmbs.length === 0) {
        return [];
      }
      const qEmb = qEmbs[0];

      const scoredDocs = [];
      for (const doc of this.docs) {
        const docEmb = doc.metadata && doc.metadata.embedding;
        if (docEmb) {
          // Cosine similarity: dot product of normalized vectors
          let sim = 0;
          const minLen = Math.min(qEmb.length, docEmb.length);
          for (let i = 0; i < minLen; i++) {
            sim += qEmb[i] * docEmb[i];
          }
          scoredDocs.push({ sim, doc });
        }
      }

      scoredDocs.sort((a, b) => b.sim - a.sim);
      return scoredDocs.slice(0, k).map(x => x.doc);
    } catch (err) {
      console.error('[vectorStore] similaritySearch error:', err);
      return [];
    }
  }

  asRetriever(searchKwargs = {}) {
    const self = this;
    const k = (searchKwargs.search_kwargs && searchKwargs.search_kwargs.k) || searchKwargs.k || TOP_K;
    return {
      async invoke(query) {
        return self.similaritySearch(query, k);
      }
    };
  }
}

/**
 * Create a CloudVectorStore from an array of documents.
 */
async function createVectorStore(docs) {
  let normalizedDocs = [];
  if (typeof docs === 'string') {
    normalizedDocs = [{ name: 'Unknown', text: docs }];
  } else if (Array.isArray(docs)) {
    normalizedDocs = docs;
  } else {
    return null;
  }

  const rawDocuments = [];
  for (const doc of normalizedDocs) {
    const name = doc.name || 'Unknown';
    let pages = doc.pages;
    if (!pages || pages.length === 0) {
      pages = [{ text: doc.text || '', page: 1 }];
    }

    for (const pageData of pages) {
      const pageText = pageData.text || '';
      const pageNum = pageData.page || 1;
      if (pageText.trim()) {
        rawDocuments.push({
          pageContent: pageText,
          metadata: {
            source: name,
            page: pageNum
          }
        });
      }
    }
  }

  if (rawDocuments.length === 0) {
    return null;
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP
  });

  const chunks = [];
  for (const rawDoc of rawDocuments) {
    const splitTexts = splitter.splitText(rawDoc.pageContent);
    for (const textPart of splitTexts) {
      chunks.push({
        pageContent: textPart,
        metadata: {
          ...rawDoc.metadata
        }
      });
    }
  }

  if (chunks.length === 0) {
    return null;
  }

  const texts = chunks.map(c => c.pageContent);
  const vectors = await embedTexts(texts, 'passage');

  for (let i = 0; i < chunks.length; i++) {
    chunks[i].metadata.chunk_index = i;
    chunks[i].metadata.embedding = vectors[i];
  }

  return new CloudVectorStore(chunks);
}

/**
 * Create or update persistent vector store on disk.
 */
async function createOrUpdateVectorStore(documents) {
  const unembeddedChunks = [];
  for (const doc of documents) {
    if (!doc.metadata || !doc.metadata.embedding) {
      unembeddedChunks.push(doc);
    }
  }

  if (unembeddedChunks.length > 0) {
    const textsToEmbed = unembeddedChunks.map(c => c.pageContent);
    const vectors = await embedTexts(textsToEmbed, 'passage');
    for (let i = 0; i < unembeddedChunks.length; i++) {
      if (!unembeddedChunks[i].metadata) {
        unembeddedChunks[i].metadata = {};
      }
      unembeddedChunks[i].metadata.embedding = vectors[i];
    }
  }

  let existingDocs = [];
  if (fs.existsSync(VECTOR_STORE_FILE)) {
    try {
      const rawData = fs.readFileSync(VECTOR_STORE_FILE, 'utf8');
      const data = JSON.parse(rawData);
      for (const item of data) {
        existingDocs.push({
          pageContent: item.page_content || item.pageContent,
          metadata: item.metadata || {}
        });
      }
      console.log(`[vectorStore] Loaded persisted index with ${existingDocs.length} chunks`);
    } catch (err) {
      console.warn(`[vectorStore] Failed to load existing index:`, err);
    }
  }

  existingDocs.push(...documents);

  // Persist to disk
  try {
    const serializable = existingDocs.map(d => ({
      page_content: d.pageContent,
      metadata: d.metadata
    }));
    fs.mkdirSync(path.dirname(VECTOR_STORE_FILE), { recursive: true });
    fs.writeFileSync(VECTOR_STORE_FILE, JSON.stringify(serializable, null, 2), 'utf8');
    console.log(`[vectorStore] Saved index with ${existingDocs.length} chunks to ${VECTOR_STORE_FILE}`);
  } catch (err) {
    console.error(`[vectorStore] Failed to save index:`, err);
  }

  return new CloudVectorStore(existingDocs);
}

function getRetriever(vectorStore, searchKwargs = {}) {
  if (!vectorStore) return null;
  return vectorStore.asRetriever(searchKwargs);
}

module.exports = {
  embedTexts,
  CloudVectorStore,
  createVectorStore,
  createOrUpdateVectorStore,
  getRetriever
};
