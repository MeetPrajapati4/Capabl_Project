/**
 * queryEnhancer.js — Academic Query Enhancement & Follow-up Suggester
 * 
 * Transforms informal, vague, or terse researcher queries into rigorous,
 * PhD-level scientific inquiries specifying boundary conditions, formal
 * proofs, algorithmic complexity, or empirical methodologies.
 */

function enhanceResearchQuery(rawQuery) {
  const q = (rawQuery || '').trim();
  if (!q) return q;

  const qLower = q.toLowerCase();

  // If already long and detailed (> 120 chars), preserve the author's precise wording
  if (q.length > 140) {
    return q;
  }

  // Common research expansions
  if (/^(what is|explain|tell me about)\s+(.+)$/i.test(q)) {
    const topic = q.replace(/^(what is|explain|tell me about)\s+/i, '').replace(/\?+$/, '').trim();
    return `Provide a comprehensive, doctoral-level academic treatise on ${topic}. Formulate the governing theoretical foundations, mathematical definitions, core algorithmic or physical mechanisms, asymptotic complexity or performance limits, and standard literature citations.`;
  }

  if (/^(compare|difference between|vs)\s+(.+)$/i.test(q)) {
    const rest = q.replace(/^(compare|difference between|vs)\s+/i, '').replace(/\?+$/, '').trim();
    return `Provide a rigorous comparative analysis of ${rest}. Include a formal feature comparison matrix, theoretical trade-offs, computational complexity, empirical benchmarks, and recommended selection criteria for production research.`;
  }

  if (/^(derive|prove|proof of)\s+(.+)$/i.test(q)) {
    const topic = q.replace(/^(derive|prove|proof of)\s+/i, '').replace(/\?+$/, '').trim();
    return `Provide a complete, step-by-step formal mathematical derivation and proof for ${topic}. State all initial lemmas, boundary conditions, governing equations, and intermediate steps through to the final theorem.`;
  }

  if (/^(code|implement|algorithm for|write)\s+(.+)$/i.test(q)) {
    const topic = q.replace(/^(code|implement|algorithm for|write)\s+/i, '').replace(/\?+$/, '').trim();
    return `Implement a complete, production-grade, highly optimized algorithm for ${topic}. Include full theoretical Big-O time and space complexity, edge-case invariants, and fully functional, non-truncated code with zero omitted helper methods.`;
  }

  // Fallback research enhancement for short concepts (e.g. "transformer architecture", "quicksort", "raft consensus")
  return `Analyze ${q} from a graduate and doctoral research perspective. Detail theoretical foundations, formal mechanisms, edge conditions, computational complexity, and seminal reference publications.`;
}

/**
 * Extracts or generates 3 doctoral-level follow-up research questions based on the topic and query.
 */
function generateFollowUpQuestions(query, content = '') {
  const cleanQ = (query || '').toLowerCase();
  
  if (cleanQ.includes('quantum') || cleanQ.includes('qubit')) {
    return [
      "What are the decoherence limits and error correction thresholds (e.g., surface codes)?",
      "How does this scale in terms of quantum circuit depth and gate fidelity?",
      "What are the primary physical realization bottlenecks (superconducting vs. trapped-ion)?"
    ];
  }

  if (cleanQ.includes('transformer') || cleanQ.includes('attention') || cleanQ.includes('llm')) {
    return [
      "What are the asymptotic bounds of flash attention versus sparse attention mechanisms?",
      "How do scaling laws (Chinchilla vs. Kaplan) constrain compute-optimal training here?",
      "What are the mathematical properties of the loss landscape during post-training alignment?"
    ];
  }

  if (cleanQ.includes('sort') || cleanQ.includes('graph') || cleanQ.includes('tree') || cleanQ.includes('algorithm')) {
    return [
      "What are the tight lower bounds for time complexity in the worst and average cases?",
      "How does cache hierarchy and memory locality impact practical wall-clock execution?",
      "Can this be parallelized via work-stealing or GPU primitives without lock contention?"
    ];
  }

  if (cleanQ.includes('consensus') || cleanQ.includes('distributed') || cleanQ.includes('raft') || cleanQ.includes('paxos')) {
    return [
      "How does this handle network partitions under the FLP impossibility theorem?",
      "What are the exact quorum requirements and failover latency profiles?",
      "How is state machine replication compacted or snapshotted under heavy write loads?"
    ];
  }

  // General doctoral research follow-ups
  const topicShort = query ? query.slice(0, 30).replace(/[^a-zA-Z0-9 ]/g, '') : "this topic";
  return [
    `What are the foundational theoretical assumptions and boundary limitations of ${topicShort}?`,
    `How does computational and space complexity scale asymptotically under worst-case inputs?`,
    `What empirical benchmarks and seminal literature validate this formulation?`
  ];
}

module.exports = {
  enhanceResearchQuery,
  generateFollowUpQuestions
};
