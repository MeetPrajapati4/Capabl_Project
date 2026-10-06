/**
 * config.js — Centralized Configuration (NVIDIA Exclusive)
 * 
 * ⚠️ MODEL LOCK — DO NOT MODIFY THESE MODEL STRINGS ⚠️
 */
require('dotenv').config();

const rawKey = (process.env.NVIDIA_API_KEY || "").trim();
const isKeyPlaceholder = !rawKey || rawKey === "your_nvidia_api_key_here";

if (isKeyPlaceholder) {
  console.warn("\n===================================================================");
  console.warn("⚠️  ATTENTION: NVIDIA_API_KEY is not configured in .env!");
  console.warn("👉 Please copy .env.example to .env and set your personal key:");
  console.warn("   NVIDIA_API_KEY=nvapi-your-key-here");
  console.warn("👉 Obtain a free key (1,000 credits) at: https://build.nvidia.com");
  console.warn("===================================================================\n");
}

const NVIDIA_API_KEY = isKeyPlaceholder ? "" : rawKey;

const CHAT_MODEL = "minimaxai/minimax-m3";
const STUDY_MODEL = "google/gemma-4-31b-it";
const ALLOWED_MODELS = [CHAT_MODEL, STUDY_MODEL];

const TEMPERATURE = 0.2;
const TOP_P = 0.8;
const MAX_TOKENS = 1024;

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;
const TOP_K = 2;

const UPLOAD_DIR = "uploaded_docs";
const ALLOWED_EXTENSIONS = ["pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls", "txt", "md"];

module.exports = {
  NVIDIA_API_KEY,
  CHAT_MODEL,
  STUDY_MODEL,
  ALLOWED_MODELS,
  TEMPERATURE,
  TOP_P,
  MAX_TOKENS,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  TOP_K,
  UPLOAD_DIR,
  ALLOWED_EXTENSIONS
};
