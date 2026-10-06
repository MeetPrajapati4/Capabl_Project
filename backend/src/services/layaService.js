/**
 * layaService.js — Local Node.js ONNX Laya Decision Service
 * 
 * Provides structured decision-making and personalization for AskiFy AI.
 * Uses @receptron/laya for student intent, difficulty estimation, and study path personalization.
 */

const { Laya } = require('@receptron/laya');

// Valid safe enum definitions
const VALID_ENUMS = {
  intent: new Set([
    "document_qa",
    "explain_topic",
    "summarize",
    "generate_flashcards",
    "generate_quiz",
    "create_roadmap",
    "solve_question",
    "explain_code",
    "debug_code",
    "general_academic_help"
  ]),
  responseStyle: new Set([
    "simple_hinglish",
    "simple_english",
    "concise_revision_notes",
    "detailed_academic",
    "example_based",
    "step_by_step",
    "code_first"
  ]),
  difficultyLevel: new Set([
    "beginner",
    "intermediate",
    "advanced"
  ]),
  nextAction: new Set([
    "explain",
    "provide_example",
    "retrieve_document_context",
    "generate_quiz",
    "generate_flashcards",
    "create_roadmap",
    "give_hint",
    "request_code_or_more_context"
  ]),
  retrievalMode: new Set([
    "must_use_uploaded_documents",
    "use_documents_if_relevant",
    "general_knowledge_ok",
    "ask_user_to_upload_document"
  ]),
  quizDifficulty: new Set([
    "easy",
    "medium",
    "hard"
  ]),
  struggleLevel: new Set([
    "not_struggling",
    "slightly_confused",
    "confused",
    "strongly_stuck"
  ]),
  priority: new Set([
    "normal",
    "exam_urgent",
    "high"
  ])
};

// Typed questions for Laya systemOne API
const LAYA_QUESTIONS = {
  intent: {
    type: "choice",
    instructions: "What is the student's main academic intent?",
    criteria: [
      "Document Q&A",
      "Explain a topic",
      "Summarize notes",
      "Generate flashcards",
      "Generate a quiz",
      "Create a learning roadmap",
      "Solve a study question",
      "Explain code",
      "Debug code",
      "General academic help"
    ]
  },
  responseStyle: {
    type: "choice",
    instructions: "What answer style will help the student most?",
    criteria: [
      "Simple Hinglish",
      "Simple English",
      "Concise revision notes",
      "Detailed academic explanation",
      "Example-based explanation",
      "Step-by-step explanation",
      "Code-first explanation"
    ]
  },
  nextAction: {
    type: "choice",
    instructions: "What should AskiFy do first?",
    criteria: [
      "Explain",
      "Provide an example",
      "Retrieve uploaded document context",
      "Generate a quiz",
      "Generate flashcards",
      "Create a roadmap",
      "Give a hint",
      "Request code or more context"
    ]
  },
  retrievalMode: {
    type: "choice",
    instructions: "How should document context be used?",
    criteria: [
      "Must use uploaded documents",
      "Use documents if relevant",
      "General knowledge is enough",
      "Ask the user to upload a document"
    ]
  },
  quizDifficulty: {
    type: "choice",
    instructions: "What quiz difficulty is appropriate?",
    criteria: [
      "Easy",
      "Medium",
      "Hard"
    ]
  },
  struggleLevel: {
    type: "choice",
    instructions: "How much is the student struggling?",
    criteria: [
      "Not struggling",
      "Slightly confused",
      "Confused",
      "Strongly stuck"
    ]
  },
  priority: {
    type: "choice",
    instructions: "What is the urgency level?",
    criteria: [
      "Normal",
      "Exam urgent",
      "High"
    ]
  }
};

// Mappings from Laya output choice labels to normalized enums
const INTENT_MAP = {
  "Document Q&A": "document_qa",
  "Explain a topic": "explain_topic",
  "Summarize notes": "summarize",
  "Generate flashcards": "generate_flashcards",
  "Generate a quiz": "generate_quiz",
  "Create a learning roadmap": "create_roadmap",
  "Solve a study question": "solve_question",
  "Explain code": "explain_code",
  "Debug code": "debug_code",
  "General academic help": "general_academic_help"
};

const STYLE_MAP = {
  "Simple Hinglish": "simple_hinglish",
  "Simple English": "simple_english",
  "Concise revision notes": "concise_revision_notes",
  "Detailed academic explanation": "detailed_academic",
  "Example-based explanation": "example_based",
  "Step-by-step explanation": "step_by_step",
  "Code-first explanation": "code_first"
};

const ACTION_MAP = {
  "Explain": "explain",
  "Provide an example": "provide_example",
  "Retrieve uploaded document context": "retrieve_document_context",
  "Generate a quiz": "generate_quiz",
  "Generate flashcards": "generate_flashcards",
  "Create a roadmap": "create_roadmap",
  "Give a hint": "give_hint",
  "Request code or more context": "request_code_or_more_context"
};

const RETRIEVAL_MAP = {
  "Must use uploaded documents": "must_use_uploaded_documents",
  "Use documents if relevant": "use_documents_if_relevant",
  "General knowledge is enough": "general_knowledge_ok",
  "Ask the user to upload a document": "ask_user_to_upload_document"
};

const QUIZ_DIFF_MAP = {
  "Easy": "easy",
  "Medium": "medium",
  "Hard": "hard"
};

const STRUGGLE_MAP = {
  "Not struggling": "not_struggling",
  "Slightly confused": "slightly_confused",
  "Confused": "confused",
  "Strongly stuck": "strongly_stuck"
};

const PRIORITY_MAP = {
  "Normal": "normal",
  "Exam urgent": "exam_urgent",
  "High": "high"
};

// Singleton / promise-cached lazy loader
let layaModelPromise = null;
let isLayaFailedOnce = false;

async function getLayaModel() {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  if (isLayaFailedOnce) {
    // If previous attempt failed, avoid tight retry loops during the request
    return null;
  }

  if (!layaModelPromise) {
    layaModelPromise = (async () => {
      try {
        console.log(`[${new Date().toISOString()}] [LayaService] Initializing Laya ONNX decision model...`);
        const loadPromise = Laya.load();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Laya initialization timeout')), 800)
        );
        const model = await Promise.race([loadPromise, timeoutPromise]);
        console.log(`[${new Date().toISOString()}] [LayaService] Laya ONNX model successfully loaded and cached in memory.`);
        return model;
      } catch (err) {
        console.warn(`[${new Date().toISOString()}] [LayaService] Laya ONNX model not immediately available (${err.message}). Using deterministic fallback rules.`);
        isLayaFailedOnce = true;
        // Allow retry after 60 seconds
        setTimeout(() => {
          isLayaFailedOnce = false;
          layaModelPromise = null;
        }, 60000);
        return null;
      }
    })();
  }
  return layaModelPromise;
}

/**
 * Validate and normalize a decision object to ensure only valid enums exist.
 */
function normalizeAndValidateDecision(raw) {
  const norm = {
    intent: VALID_ENUMS.intent.has(raw?.intent) ? raw.intent : "explain_topic",
    responseStyle: VALID_ENUMS.responseStyle.has(raw?.responseStyle) ? raw.responseStyle : "detailed_academic",
    difficultyLevel: VALID_ENUMS.difficultyLevel.has(raw?.difficultyLevel) ? raw.difficultyLevel : "intermediate",
    nextAction: VALID_ENUMS.nextAction.has(raw?.nextAction) ? raw.nextAction : "explain",
    retrievalMode: VALID_ENUMS.retrievalMode.has(raw?.retrievalMode) ? raw.retrievalMode : "general_knowledge_ok",
    quizDifficulty: VALID_ENUMS.quizDifficulty.has(raw?.quizDifficulty) ? raw.quizDifficulty : "medium",
    struggleLevel: VALID_ENUMS.struggleLevel.has(raw?.struggleLevel) ? raw.struggleLevel : "not_struggling",
    priority: VALID_ENUMS.priority.has(raw?.priority) ? raw.priority : "normal",
    confidence: typeof raw?.confidence === "number" && !isNaN(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.85,
    fallbackUsed: Boolean(raw?.fallbackUsed)
  };
  return norm;
}

/**
 * Apply deterministic academic rules before/after Laya inference.
 */
function applyDeterministicFallbackRules({
  studentMessage = "",
  requestedFeature = "",
  userProfile = {},
  learningProgress = {},
  documentContextAvailable = false,
  baseDecision = null
}) {
  const msgLower = (studentMessage || "").toLowerCase();

  // Dynamic academic level & language detection across Std 6 to PhD spectrum
  const isPhdOrResearch = [
    "phd", "research", "doctoral", "thesis", "dissertation", "derivation", "proof", "prove",
    "lagrangian", "hamiltonian", "quantum", "tensor", "manifold", "topology", "stochastic",
    "eigenvalue", "eigenvector", "cryptography", "asymptotic", "pathway", "mechanism of action",
    "pharmacokinetics", "oncology", "epigenetic", "homotopy", "schrodinger", "non-linear",
    "advanced", "theoretical", "formalism", "rigorous"
  ].some(kw => msgLower.includes(kw));

  const isMiddleSchoolStd6to8 = [
    "class 6", "std 6", "standard 6", "grade 6",
    "class 7", "std 7", "standard 7", "grade 7",
    "class 8", "std 8", "standard 8", "grade 8",
    "simply", "explain simply", "for kids", "very simple", "easy words",
    "basic explanation", "explain like i am 10", "explain like i'm 10"
  ].some(kw => msgLower.includes(kw));

  const isExplicitHinglish = [
    "batao", "samjhao", "kya hota hai", "kaise hota hai", "kya hai", "kyun",
    "kripya", "hindi", "hinglish", "samjha do", "bata do"
  ].some(kw => msgLower.includes(kw)) || userProfile?.languagePreference === "Hinglish";

  let defaultStyle = "detailed_academic";
  let defaultLevel = "intermediate";

  if (isExplicitHinglish) {
    defaultStyle = "simple_hinglish";
  } else if (isMiddleSchoolStd6to8) {
    defaultStyle = "simple_english";
    defaultLevel = "beginner";
  } else if (isPhdOrResearch) {
    defaultStyle = "detailed_academic";
    defaultLevel = "advanced";
  }

  const decision = {
    intent: baseDecision?.intent || "explain_topic",
    responseStyle: baseDecision?.responseStyle || userProfile?.responseStyle || defaultStyle,
    difficultyLevel: baseDecision?.difficultyLevel || userProfile?.level || defaultLevel,
    nextAction: baseDecision?.nextAction || "explain",
    retrievalMode: baseDecision?.retrievalMode || (documentContextAvailable ? "use_documents_if_relevant" : "general_knowledge_ok"),
    quizDifficulty: baseDecision?.quizDifficulty || (defaultLevel === "advanced" ? "hard" : defaultLevel === "beginner" ? "easy" : "medium"),
    struggleLevel: baseDecision?.struggleLevel || "not_struggling",
    priority: baseDecision?.priority || "normal",
    confidence: typeof baseDecision?.confidence === "number" ? baseDecision.confidence : 0.85,
    fallbackUsed: baseDecision ? baseDecision.fallbackUsed : true
  };

  // 1. Explicit feature overrides
  if (requestedFeature === "flashcards") {
    decision.intent = "generate_flashcards";
    decision.nextAction = "generate_flashcards";
  } else if (requestedFeature === "quiz") {
    decision.intent = "generate_quiz";
    decision.nextAction = "generate_quiz";
  } else if (requestedFeature === "roadmap") {
    decision.intent = "create_roadmap";
    decision.nextAction = "create_roadmap";
  } else if (requestedFeature === "document_qa") {
    decision.intent = "document_qa";
    decision.retrievalMode = "must_use_uploaded_documents";
  }

  // 2. Exam urgency detection
  const examKeywords = ["kal exam", "exam tomorrow", "tomorrow exam", "urgent exam", "exam hai", "test tomorrow"];
  if (examKeywords.some(kw => msgLower.includes(kw))) {
    decision.priority = "exam_urgent";
    decision.responseStyle = "concise_revision_notes";
  }

  // 3. Document-specific query keywords
  const docKeywords = [
    "according to my notes", "from this pdf", "from uploaded file",
    "from this document", "slides", "my notes", "in the pdf", "in my notes", "in the file",
    "this pdf", "uploaded file", "this document", "pdf file", "my document"
  ];
  if (docKeywords.some(kw => msgLower.includes(kw))) {
    if (documentContextAvailable) {
      decision.retrievalMode = "must_use_uploaded_documents";
      decision.intent = "document_qa";
      decision.nextAction = "retrieve_document_context";
    } else {
      decision.retrievalMode = "ask_user_to_upload_document";
      decision.nextAction = "request_code_or_more_context";
    }
  }

  // 4. Learning progress & quiz accuracy
  const accuracy = typeof learningProgress?.quizAccuracy === 'number' ? learningProgress.quizAccuracy : null;
  const wrongStreak = Number(learningProgress?.wrongStreak) || 0;
  const hintsUsed = Number(learningProgress?.hintsUsed) || 0;

  if ((accuracy !== null && accuracy < 40) || wrongStreak >= 3) {
    decision.difficultyLevel = "beginner";
    decision.quizDifficulty = "easy";
    decision.struggleLevel = "strongly_stuck";
  } else if (accuracy !== null && accuracy > 85 && wrongStreak === 0 && hintsUsed <= 1) {
    decision.quizDifficulty = "hard";
    decision.difficultyLevel = "advanced";
  }

  // 5. Code intent detection
  if (["error", "exception", "bug", "traceback", "debug", "fix code", "syntaxerror"].some(kw => msgLower.includes(kw))) {
    decision.intent = "debug_code";
    decision.responseStyle = "code_first";
  } else if (["write a program", "code for", "function to", "write code", "implement in"].some(kw => msgLower.includes(kw))) {
    decision.intent = "explain_code";
    decision.responseStyle = "code_first";
  }

  return normalizeAndValidateDecision(decision);
}

/**
 * Main entry point: Get structured learning decision using Laya with deterministic fallback.
 */
async function getLearningDecision({
  studentMessage = "",
  requestedFeature = "",
  userProfile = {},
  learningProgress = {},
  documentContextAvailable = false
} = {}) {
  // Fast check: If requestedFeature explicitly dictates the intent, apply deterministic rules directly
  if (["flashcards", "quiz", "roadmap"].includes(requestedFeature)) {
    return applyDeterministicFallbackRules({
      studentMessage,
      requestedFeature,
      userProfile,
      learningProgress,
      documentContextAvailable,
      baseDecision: { fallbackUsed: true, confidence: 1.0 }
    });
  }

  let layaResult = null;
  let model = null;

  try {
    model = await getLayaModel();
    if (model) {
      // Build safe, minimal state for Laya (no raw documents or private secrets)
      const layaState = {
        student_message: String(studentMessage || "").slice(0, 500),
        requested_feature: requestedFeature || "none",
        learner_level: userProfile?.level || "unknown",
        preferred_language: userProfile?.languagePreference || "Hinglish",
        academic_goal: userProfile?.goal || "general_learning",
        current_or_recent_topic: learningProgress?.recentTopic || "unknown",
        recent_quiz_accuracy: learningProgress?.quizAccuracy ?? "unknown",
        wrong_answer_streak: learningProgress?.wrongStreak ?? 0,
        hints_used: learningProgress?.hintsUsed ?? 0,
        document_context_available: documentContextAvailable ? "yes" : "no"
      };

      const inferenceTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Laya inference timeout')), 350)
      );
      layaResult = await Promise.race([
        model.systemOne(layaState, LAYA_QUESTIONS),
        inferenceTimeout
      ]);
    }
  } catch (err) {
    console.warn(`[${new Date().toISOString()}] [LayaService] Inference error: ${err.message}. Activating deterministic fallback.`);
    layaResult = null;
  }

  if (!layaResult || !layaResult.answers) {
    return applyDeterministicFallbackRules({
      studentMessage,
      requestedFeature,
      userProfile,
      learningProgress,
      documentContextAvailable,
      baseDecision: { fallbackUsed: true, confidence: 0.85 }
    });
  }

  // Parse Laya answers
  const answers = layaResult.answers;
  const intentChoice = answers.intent?.choice;
  const styleChoice = answers.responseStyle?.choice;
  const actionChoice = answers.nextAction?.choice;
  const retrievalChoice = answers.retrievalMode?.choice;
  const quizDiffChoice = answers.quizDifficulty?.choice;
  const struggleChoice = answers.struggleLevel?.choice;
  const priorityChoice = answers.priority?.choice;

  // Calculate average confidence across answers
  const confidences = [
    answers.intent?.confidence,
    answers.responseStyle?.confidence,
    answers.nextAction?.confidence,
    answers.retrievalMode?.confidence
  ].filter(c => typeof c === 'number' && !isNaN(c));

  const avgConfidence = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0.5;

  const confidenceThreshold = 0.60;
  const fallbackNeeded = avgConfidence < confidenceThreshold;

  const rawDecision = {
    intent: INTENT_MAP[intentChoice] || "explain_topic",
    responseStyle: STYLE_MAP[styleChoice] || "simple_hinglish",
    difficultyLevel: userProfile?.level || "beginner",
    nextAction: ACTION_MAP[actionChoice] || "explain",
    retrievalMode: RETRIEVAL_MAP[retrievalChoice] || (documentContextAvailable ? "use_documents_if_relevant" : "general_knowledge_ok"),
    quizDifficulty: QUIZ_DIFF_MAP[quizDiffChoice] || "medium",
    struggleLevel: STRUGGLE_MAP[struggleChoice] || "not_struggling",
    priority: PRIORITY_MAP[priorityChoice] || "normal",
    confidence: Number(avgConfidence.toFixed(2)),
    fallbackUsed: fallbackNeeded
  };

  // Re-apply deterministic rules over Laya decision to ensure strict academic safety
  return applyDeterministicFallbackRules({
    studentMessage,
    requestedFeature,
    userProfile,
    learningProgress,
    documentContextAvailable,
    baseDecision: rawDecision
  });
}

/**
 * Personalize system prompt using the learning decision.
 */
function applyLearningPlanToPrompt(basePrompt, learningPlan) {
  if (!learningPlan) return basePrompt;

  const directives = [];

  // Academic Level Directive (Std 6 to PhD)
  if (learningPlan.difficultyLevel === "beginner") {
    directives.push("TARGET AUDIENCE: Standard 6–8 (Middle School). Use intuitive real-world analogies, step-by-step clarity, and accessible language.");
  } else if (learningPlan.difficultyLevel === "advanced") {
    directives.push("TARGET AUDIENCE: Graduate / PhD / Research Level. Maintain advanced academic rigor, theoretical depth, domain-specific terminology, mathematical precision, and research-level insight without oversimplification.");
  } else {
    directives.push("TARGET AUDIENCE: Standard 9–12 to Undergraduate. Provide structured textbook rigor, exact scientific formulas, step-by-step logic, and standard academic nomenclature.");
  }

  // Style directive
  switch (learningPlan.responseStyle) {
    case "simple_hinglish":
      directives.push("Explain in natural Hinglish (Hindi + English) as specifically requested by the user, while preserving academic and scientific accuracy.");
      break;
    case "simple_english":
      directives.push("Use clear, engaging English with relatable real-world analogies suitable for school students.");
      break;
    case "concise_revision_notes":
      directives.push("Provide exam-focused bullet revision notes: key definitions, core formulas, high-yield points, and common student mistakes.");
      break;
    case "detailed_academic":
      directives.push("Provide a structured, scholarly conceptual explanation with clear headings, exact definitions, and logical progression.");
      break;
    case "example_based":
      directives.push("Teach through one clear, realistic, educational real-world example.");
      break;
    case "step_by_step":
      directives.push("Present the solution in numbered, sequential steps without skipping logical jumps.");
      break;
    case "code_first":
      directives.push("Present clean, production-ready code with comments, followed by algorithmic complexity and logic analysis.");
      break;
  }

  // Priority directive
  if (learningPlan.priority === "exam_urgent") {
    directives.push("EXAM URGENT: Prioritize high-yield exam concepts, formula recap, and 3 quick practice questions.");
  }

  // Retrieval directive
  if (learningPlan.retrievalMode === "ask_user_to_upload_document") {
    directives.push("NOTICE: The student asked a document-specific question but no documents are currently uploaded. Politely request them to upload the relevant file or paste the text.");
  } else if (learningPlan.retrievalMode === "must_use_uploaded_documents") {
    directives.push("STRICT DOCUMENT GROUNDING: Answer strictly based on the provided document excerpts. Cite sources clearly.");
  }

  if (directives.length === 0) return basePrompt;

  return `${basePrompt}\n\n[PERSONALIZED LEARNING DIRECTIVES - LAYA]\n${directives.map((d, i) => `${i + 1}. ${d}`).join('\n')}`;
}

module.exports = {
  getLayaModel,
  getLearningDecision,
  applyLearningPlanToPrompt,
  applyDeterministicFallbackRules,
  normalizeAndValidateDecision,
  VALID_ENUMS,
  LAYA_QUESTIONS
};
