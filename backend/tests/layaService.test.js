/**
 * layaService.test.js — Unit Tests for Laya Decision Service
 * 
 * Verifies decision-making, fallback rules, normalization, and safety without external APIs or model downloads.
 */

process.env.NODE_ENV = 'test';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { 
  getLearningDecision, 
  applyLearningPlanToPrompt, 
  normalizeAndValidateDecision,
  VALID_ENUMS 
} = require('../src/services/layaService');

describe('Laya Decision Service Tests', () => {

  test('1. Explicit flashcard/quiz/roadmap selection overrides Laya routing', async () => {
    const flashcardDecision = await getLearningDecision({
      studentMessage: "I want to study physics",
      requestedFeature: "flashcards"
    });
    assert.equal(flashcardDecision.intent, 'generate_flashcards');
    assert.equal(flashcardDecision.nextAction, 'generate_flashcards');

    const quizDecision = await getLearningDecision({
      studentMessage: "Check my understanding",
      requestedFeature: "quiz"
    });
    assert.equal(quizDecision.intent, 'generate_quiz');
    assert.equal(quizDecision.nextAction, 'generate_quiz');

    const roadmapDecision = await getLearningDecision({
      studentMessage: "How do I study machine learning?",
      requestedFeature: "roadmap"
    });
    assert.equal(roadmapDecision.intent, 'create_roadmap');
    assert.equal(roadmapDecision.nextAction, 'create_roadmap');
  });

  test('2. A document-specific message selects must_use_uploaded_documents when docs available', async () => {
    const decision = await getLearningDecision({
      studentMessage: "According to my notes, what is the formula for kinetic energy?",
      documentContextAvailable: true
    });
    assert.equal(decision.retrievalMode, 'must_use_uploaded_documents');
    assert.equal(decision.intent, 'document_qa');
  });

  test('3. Document-specific message asks user to upload when no docs available', async () => {
    const decision = await getLearningDecision({
      studentMessage: "What is written in this PDF file?",
      documentContextAvailable: false
    });
    assert.equal(decision.retrievalMode, 'ask_user_to_upload_document');
    assert.equal(decision.nextAction, 'request_code_or_more_context');
  });

  test('4. "Kal exam hai" or "exam tomorrow" selects exam_urgent priority', async () => {
    const decisionTomorrow = await getLearningDecision({
      studentMessage: "Please explain thermodynamics quickly, exam tomorrow!"
    });
    assert.equal(decisionTomorrow.priority, 'exam_urgent');
    assert.equal(decisionTomorrow.responseStyle, 'concise_revision_notes');

    const decisionHinglish = await getLearningDecision({
      studentMessage: "Mera kal exam hai, help me revise organic chemistry."
    });
    assert.equal(decisionHinglish.priority, 'exam_urgent');
  });

  test('5. Low quiz accuracy or 3+ wrong answers selects beginner/easy/strongly_stuck', async () => {
    const decisionLowAcc = await getLearningDecision({
      studentMessage: "I am confused by this calculus step",
      learningProgress: { quizAccuracy: 35, wrongStreak: 1 }
    });
    assert.equal(decisionLowAcc.difficultyLevel, 'beginner');
    assert.equal(decisionLowAcc.quizDifficulty, 'easy');
    assert.equal(decisionLowAcc.struggleLevel, 'strongly_stuck');

    const decisionWrongStreak = await getLearningDecision({
      studentMessage: "Trying again",
      learningProgress: { quizAccuracy: 60, wrongStreak: 3 }
    });
    assert.equal(decisionWrongStreak.difficultyLevel, 'beginner');
    assert.equal(decisionWrongStreak.quizDifficulty, 'easy');
    assert.equal(decisionWrongStreak.struggleLevel, 'strongly_stuck');
  });

  test('6. High quiz accuracy selects hard quiz difficulty and advanced level', async () => {
    const decisionHighAcc = await getLearningDecision({
      studentMessage: "Give me the next problem",
      learningProgress: { quizAccuracy: 90, wrongStreak: 0, hintsUsed: 0 }
    });
    assert.equal(decisionHighAcc.quizDifficulty, 'hard');
    assert.equal(decisionHighAcc.difficultyLevel, 'advanced');
  });

  test('7. Invalid or malformed decision fields are normalized safely', () => {
    const invalidInput = {
      intent: "INVALID_INTENT_STRING",
      responseStyle: "broken_style",
      difficultyLevel: "super_expert",
      confidence: "not_a_number",
      fallbackUsed: "yes"
    };

    const normalized = normalizeAndValidateDecision(invalidInput);
    assert.ok(VALID_ENUMS.intent.has(normalized.intent));
    assert.ok(VALID_ENUMS.responseStyle.has(normalized.responseStyle));
    assert.ok(VALID_ENUMS.difficultyLevel.has(normalized.difficultyLevel));
    assert.equal(typeof normalized.confidence, 'number');
    assert.ok(normalized.confidence >= 0 && normalized.confidence <= 1);
    assert.equal(typeof normalized.fallbackUsed, 'boolean');
  });

  test('8. Prompt personalization adds structured educational directives', () => {
    const basePrompt = "You are Askify.";
    const learningPlan = {
      responseStyle: "simple_hinglish",
      priority: "exam_urgent",
      difficultyLevel: "beginner",
      retrievalMode: "must_use_uploaded_documents"
    };

    const enhanced = applyLearningPlanToPrompt(basePrompt, learningPlan);
    assert.ok(enhanced.includes("You are Askify."));
    assert.ok(enhanced.includes("Hinglish"));
    assert.ok(enhanced.includes("EXAM URGENT"));
    assert.ok(enhanced.includes("beginner"));
    assert.ok(enhanced.includes("STRICT DOCUMENT GROUNDING"));
  });

});
