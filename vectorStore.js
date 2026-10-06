/**
 * vectorStore.js — Cloud Vector Store Manager (NVIDIA Cloud Embeddings - Node.js Port)
 * 
 * Replaces langchain_nvidia_ai_endpoints and FAISS with in-memory cosine similarity metrics.
 */

const fs = require('fs');
const axios = require('axios');
const { NVIDIA_API_KEY, CHUNK_SIZE, CHUNK_OVERLAP, TOP_K } = require('./config');
const { RecursiveCharacterTextSplitter } = require('./documentProcessor');

const PERSISTED_INDEX_PATH = "cloud_vector_store.json";

/**
 * Utility function to compute embeddings for an array of texts.
 */
async function embedTexts(texts, inputType = 'passage') {
  if (!texts || texts.length === 0) return [];

  const modelName = 'nvidia/llama-nemotron-embed-1b-v2';
  const batchSize = 50;
  const vectors = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    if (!NVIDIA_API_KEY || NVIDIA_API_KEY === "your_nvidia_api_key_here") {
      throw new Error("NVIDIA_API_KEY is not configured. Please add your personal NVIDIA API key to the .env file (NVIDIA_API_KEY=nvapi-...). You can obtain a free key with 1,000 credits at https://build.nvidia.com");
    }
    try {
      const response = await axios.post(
        'https://integrate.api.nvidia.com/v1/embeddings',
        {
          input: batch,
          model: modelName,
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
        // Sort by index to guarantee the correct mapping order
        const batchVectors = responseData.data
          .sort((a, b) => a.index - b.index)
          .map(item => item.embedding);
        vectors.push(...batchVectors);
      } else {
        throw new Error(`Invalid response format from NVIDIA API: ${JSON.stringify(responseData)}`);
      }
    } catch (err) {
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        throw new Error("Invalid or expired NVIDIA_API_KEY. Please check your key in .env or obtain a fresh key at https://build.nvidia.com");
      }
      console.error(`[vectorStore] Error fetching embeddings:`, err.response ? err.response.data : err.message);
      throw err;
    }
  }

  return vectors;
}

/**
 * Lightweight, high-performance serialized vector store.
 * Uses NVIDIA Cloud Embeddings and performs fast in-memory cosine similarity.
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

      // Sort by similarity descending
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
 * Create a CloudVectorStore from a list of document dicts.
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

  // Split documents into chunks
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

  // Generate embeddings in parallel via a single cloud request
  const texts = chunks.map(c => c.pageContent);
  const vectors = await embedTexts(texts, 'passage');

  for (let i = 0; i < chunks.length; i++) {
    chunks[i].metadata.chunk_index = i;
    chunks[i].metadata.embedding = vectors[i];
  }

  return new CloudVectorStore(chunks);
}

/**
 * Create a new index from documents, or merge into an existing persisted index.
 * Saves to local JSON storage.
 */
async function createOrUpdateVectorStore(documents) {
  // Ensure all new documents have embeddings computed
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

  // Check if a persisted index already exists
  let existingDocs = [];
  if (fs.existsSync(PERSISTED_INDEX_PATH)) {
    try {
      const rawData = fs.readFileSync(PERSISTED_INDEX_PATH, 'utf8');
      const data = JSON.parse(rawData);
      for (const item of data) {
        existingDocs.push({
          pageContent: item.page_content || item.pageContent,
          metadata: item.metadata || {}
        });
      }
      console.log(`[vectorStore] Found existing persisted index containing ${existingDocs.length} documents`);
    } catch (err) {
      console.warn(`[vectorStore] Failed to load existing persisted index:`, err);
    }
  }

  // Merge new documents
  existingDocs.push(...documents);

  // Save to disk
  try {
    const serializable = existingDocs.map(d => ({
      page_content: d.pageContent,
      metadata: d.metadata
    }));
    fs.writeFileSync(PERSISTED_INDEX_PATH, JSON.stringify(serializable, null, 2), 'utf8');
    console.log(`[vectorStore] Saved updated index containing ${existingDocs.length} documents to disk`);
  } catch (err) {
    console.error(`[vectorStore] Failed to persist index to disk:`, err);
  }

  return new CloudVectorStore(existingDocs);
}

/**
 * Load a previously persisted vector store from disk.
 */
function loadVectorStore() {
  if (!fs.existsSync(PERSISTED_INDEX_PATH)) {
    console.log(`[vectorStore] No persisted index found at '${PERSISTED_INDEX_PATH}'`);
    return null;
  }

  try {
    const rawData = fs.readFileSync(PERSISTED_INDEX_PATH, 'utf8');
    const data = JSON.parse(rawData);
    const docs = data.map(item => ({
      pageContent: item.page_content || item.pageContent,
      metadata: item.metadata || {}
    }));
    console.log(`[vectorStore] Loaded persisted index from '${PERSISTED_INDEX_PATH}' containing ${docs.length} documents`);
    return new CloudVectorStore(docs);
  } catch (err) {
    console.error(`[vectorStore] Error loading persisted index from '${PERSISTED_INDEX_PATH}':`, err);
    return null;
  }
}

/**
 * Delete the persisted index file.
 */
function deleteVectorStore() {
  if (fs.existsSync(PERSISTED_INDEX_PATH)) {
    try {
      fs.unlinkSync(PERSISTED_INDEX_PATH);
      console.log(`[vectorStore] Deleted persisted index file '${PERSISTED_INDEX_PATH}'`);
      return true;
    } catch (err) {
      console.error(`[vectorStore] Failed to delete persisted index:`, err);
    }
  }
  return false;
}

module.exports = {
  CloudVectorStore,
  createVectorStore,
  searchVectorStore: async (vs, query) => vs.similaritySearch(query, 3),
  createOrUpdateVectorStore,
  loadVectorStore,
  getRetriever: (vs) => vs.asRetriever({ k: 2 }),
  deleteVectorStore,
  embedTexts
};
