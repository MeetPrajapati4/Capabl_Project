/**
 * config.js — Centralized Configuration
 * 
 * Supports user-selected models with automatic failover to available API key models.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const rawKey = (process.env.NVIDIA_API_KEY || "").trim();
const isKeyPlaceholder = !rawKey || rawKey === "your_nvidia_api_key_here";

if (isKeyPlaceholder) {
  console.warn("\n===================================================================");
  console.warn("⚠️  ATTENTION: NVIDIA_API_KEY is not set in .env!");
  console.warn("👉 Please open the .env file and paste your key:");
  console.warn("   NVIDIA_API_KEY=nvapi-your-key-here");
  console.warn("👉 Get a free key at: https://build.nvidia.com");
  console.warn("===================================================================\n");
}

const NVIDIA_API_KEY = isKeyPlaceholder 
  ? "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" 
  : rawKey;

// Primary Model Requested by User (Fast response < 5-8s)
const CHAT_MODEL = "nvidia/nemotron-3-super-120b-a12b";
const STUDY_MODEL = "nvidia/nemotron-3-super-120b-a12b";

// Single Model Requested by User (Fast response < 5-8s)
const FALLBACK_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b"
];

const ALLOWED_MODELS = [
  CHAT_MODEL,
  STUDY_MODEL,
  ...FALLBACK_MODELS
];

// LLM Hyperparameters
const TEMPERATURE = 0.2;
const TOP_P = 0.8;
const MAX_TOKENS = 4096;

// Document Chunking & Retrieval Parameters
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const TOP_K = 3;

// Storage Paths
const ROOT_DIR = path.resolve(__dirname, '../..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const CHUNK_DIR = path.join(UPLOAD_DIR, 'chunks');
const CACHE_FILE = path.join(DATA_DIR, 'query_cache.json');
const VECTOR_STORE_FILE = path.join(DATA_DIR, 'cloud_vector_store.json');
const STATIC_DIR = path.join(ROOT_DIR, 'static_react');

const ALLOWED_EXTENSIONS = ["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "md"];

module.exports = {
  NVIDIA_API_KEY,
  CHAT_MODEL,
  STUDY_MODEL,
  FALLBACK_MODELS,
  ALLOWED_MODELS,
  TEMPERATURE,
  TOP_P,
  MAX_TOKENS,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  TOP_K,
  ROOT_DIR,
  DATA_DIR,
  UPLOAD_DIR,
  CHUNK_DIR,
  CACHE_FILE,
  VECTOR_STORE_FILE,
  STATIC_DIR,
  ALLOWED_EXTENSIONS
};
