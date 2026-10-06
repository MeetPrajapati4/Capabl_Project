/**
 * state.js — Central Shared In-Memory State
 * 
 * Prevents circular dependencies between server, ragEngine, and agent modules.
 */

const GLOBAL_STATE = {
  documents: [],
  vector_store: null,
  prewarm_cache: {},
  study_engine: null,
  chat_engine: null,
  warmup_complete: false
};

module.exports = {
  GLOBAL_STATE
};
