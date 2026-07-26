/**
 * state.js — Central Shared State Object
 * 
 * Prevents circular dependencies between app_api.js, ragEngine.js, and agent.js.
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
