/**
 * config.js — Centralized Configuration (NVIDIA Exclusive)
 * 
 * ⚠️ MODEL LOCK — DO NOT MODIFY THESE MODEL STRINGS ⚠️
 */
require('dotenv').config();

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY || "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";

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
