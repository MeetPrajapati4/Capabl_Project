/**
 * agent.js — Goal-Driven ReAct (Reason + Act) Autonomous Agent (Node.js Port)
 * 
 * Implements AgentTool wrappers, ReAct reasoning loops, and dynamic action parsing.
 */

const { GLOBAL_STATE } = require('./state');
const { createVectorStore, getRetriever } = require('./vectorStore');
const { sanitizeText } = require('./sanitizer');

const ACTION_REGEX = /Action:\s*(\w+)\((.*)\)/i;

const AGENT_SYSTEM_PROMPT = `<system_instruction_set>
You are Askify, an expert academic professor and Study Assistant for all subjects of the world. Your purpose is to explain topics across all disciplines (humanities, sciences, engineering, history, medicine, arts, etc.) from an educational and safe standpoint. By default, your language of communication is English.

[SAFETY & CONTRAINTS]
1. TEXTBOOK RESPONSE ONLY: Frame all explanations regarding modern generative technologies (like Image and Video generation models, Diffusion frameworks, or GANs) as high-level architectural overviews or computer science textbook definitions. 
2. NO SENSITIVE EXAMPLES: Do not discuss, generate, or provide actionable instructions for creating specific, sensitive, or harmful digital media. Focus strictly on the underlying math, algorithms, history, or science.
3. BE CONCISE: Provide the direct answer immediately in 3-4 sentences maximum. Use clean markdown bolding (**key terms**) or a short bulleted list for scannability. No introductory fluff.
4. FLEXIBLE ASSISTANT: Use uploaded document context if relevant, but rely on your broad general knowledge when the documents do not cover the user's query.
5. LANGUAGE: Respond in English by default. (Support for other languages will be added in the future).

[VOCABULARY & COMPREHENSION DIRECTIVE - STRICT]
1. Use ONLY Beginner-Level to Medium-Level vocabulary words. 
2. Explicitly BAN all overly complex, advanced academic jargon, archaic terms, and hard words that create reading friction for students.
3. Keep the tone empathetic, encouraging, and highly accessible—explain advanced technical or scientific concepts using simple, real-world analogies.
4. Maintain this simplified vocabulary without compromising mathematical or logical precision.

ReAct Format:
Thought: <brief reasoning>
Action: <tool_name>(<arg>)
OR:
Thought: <brief reasoning>
Answer: <final answer following the core behavior instructions above>
</system_instruction_set>`;

/**
 * Represents a typed, executable tool for the agent.
 */
class AgentTool {
  constructor(name, description, func, hasSideEffects = false) {
    this.name = name;
    this.description = description;
    this.func = func;
    this.hasSideEffects = hasSideEffects;
  }

  async execute(...args) {
    try {
      return await this.func(...args);
    } catch (err) {
      console.error(`Error executing tool ${this.name}:`, err);
      return `Error executing tool ${this.name}: ${err.message}`;
    }
  }
}

/**
 * Tool definitions
 */
async function toolSearchKnowledgeBase(query, vectorStore) {
  if (!vectorStore) {
    return "Observation: No documents uploaded. The knowledge base is empty. Please upload documents first.";
  }

  try {
    const retriever = getRetriever(vectorStore);
    const docs = await retriever.invoke(query);
    if (!docs || docs.length === 0) {
      return "Observation: No matching academic chunks found for this query.";
    }

    const formattedChunks = docs.map(doc => {
      const src = doc.metadata?.source || "Unknown";
      const page = doc.metadata?.page || "N/A";
      const chunkIdx = doc.metadata?.chunk_index || "N/A";
      return `[Source: ${src}, Page: ${page}, Chunk: ${chunkIdx}]\n${doc.pageContent}`;
    });

    return formattedChunks.join("\n\n---\n\n");
  } catch (err) {
    return `Observation Error: Failed to perform search: ${err.message}`;
  }
}

function toolGetDocumentList(documents) {
  if (!documents || documents.length === 0) {
    return "Observation: No documents are currently uploaded.";
  }

  const lines = ["Here are the uploaded documents:"];
  for (const doc of documents) {
    const name = doc.name || "Unknown";
    const chunks = doc.chunks || 0;
    const sizeKb = Math.round((doc.size || 0) / 1024);
    lines.push(`- 📄 ${name} (${sizeKb} KB, ${chunks} chunks)`);
  }
  return lines.join("\n");
}

function toolDeleteDocument(filename, documents) {
  let found = false;
  for (let i = documents.length - 1; i >= 0; i--) {
    if (documents[i].name === filename) {
      documents.splice(i, 1);
      found = true;
    }
  }

  if (found) {
    // Rebuild vector store asynchronously
    (async () => {
      try {
        if (GLOBAL_STATE.documents && GLOBAL_STATE.documents.length > 0) {
          GLOBAL_STATE.vector_store = await createVectorStore(GLOBAL_STATE.documents);
        } else {
          GLOBAL_STATE.vector_store = null;
        }
        console.log(`[agent] Rebuilt vector store after deleting '${filename}'`);
      } catch (err) {
        console.error(`[agent] Rebuild vector store failed:`, err);
      }
    })();

    return `Observation: Successfully deleted document '${filename}'. Vector store rebuild initiated in the background.`;
  } else {
    const names = documents.map(d => d.name).join(", ");
    return `Observation Error: Document '${filename}' was not found. Available files are: ${names}`;
  }
}

/**
 * Autonomous goal-driven agent implementing the ReAct loop.
 */
class ReActAgent {
  constructor(llm, vectorStore, documents, maxSteps = 2) {
    this.llm = llm;
    this.vectorStore = vectorStore;
    this.documents = documents;
    this.maxSteps = maxSteps;
    this.runHistory = [];

    // Register tools
    this.tools = {
      search_knowledge_base: new AgentTool(
        "search_knowledge_base",
        "Search the uploaded documents for semantic matching context.",
        (q) => toolSearchKnowledgeBase(q, this.vectorStore),
        false
      ),
      get_document_list: new AgentTool(
        "get_document_list",
        "List all files currently indexed in the academic assistant.",
        () => toolGetDocumentList(this.documents),
        false
      ),
      delete_document: new AgentTool(
        "delete_document",
        "Delete a document and trigger vector store rebuild.",
        (f) => toolDeleteDocument(f, this.documents),
        true
      )
    };
  }

  detectIntent(query) {
    const queryLower = query.toLowerCase();
    if (['difference', 'compare', 'vs', 'versus', 'distinguish', 'differentiate'].some(kw => queryLower.includes(kw))) {
      return 'comparison';
    }
    if (['roadmap', 'study plan', 'schedule', 'prepare', 'preparation', 'week-wise', 'plan for'].some(kw => queryLower.includes(kw))) {
      return 'roadmap';
    }
    if (['solve', 'answer', 'find', 'calculate', 'compute', 'derive', 'prove', 'write a program', 'write code'].some(kw => queryLower.includes(kw))) {
      return 'question_solving';
    }
    if (['summarize', 'summary', 'brief', 'short notes', 'revision'].some(kw => queryLower.includes(kw))) {
      return 'summary';
    }
    return 'topic_explanation';
  }

  extractSources(runHistory) {
    const sources = [];
    const seen = new Set();
    const sourceRegex = /\[Source:\s*([^,\]]+),\s*Page:\s*([^,\]]+)/g;

    for (const step of runHistory) {
      const obs = step.observation || "";
      let match;
      // Loop over regex matches
      while ((match = sourceRegex.exec(obs)) !== null) {
        const name = match[1].trim();
        const pageVal = match[2].trim();
        const key = `${name}_${pageVal}`;

        if (!seen.has(key)) {
          seen.add(key);
          const pageNum = isNaN(pageVal) ? pageVal : parseInt(pageVal, 10);
          sources.push({ name, page: pageNum });
        }
      }
    }
    return sources;
  }

  async executeTool(name, arg) {
    const tool = this.tools[name];
    if (!tool) {
      const toolNames = Object.keys(this.tools).join(", ");
      return `Observation Error: Tool '${name}' is not registered. Available tools: ${toolNames}`;
    }

    if (tool.name === "get_document_list") {
      return await tool.execute();
    }
    return await tool.execute(arg);
  }

  _compilePrompt(query, runHistory, chatHistory = null) {
    const messages = [
      { role: 'system', content: AGENT_SYSTEM_PROMPT }
    ];

    // Add conversation history context
    if (chatHistory && chatHistory.length > 0) {
      // Map LangChain objects or format standard objects
      const mapped = chatHistory.slice(-6).map(m => {
        let role = 'user';
        if (m.role) {
          role = m.role;
        } else if (m.constructor && m.constructor.name === 'AIMessage') {
          role = 'assistant';
        } else if (m.constructor && m.constructor.name === 'SystemMessage') {
          role = 'system';
        }
        return { role, content: m.content || String(m) };
      });
      messages.push(...mapped);
    }

    // Current query
    messages.push({ role: 'user', content: `Question: ${query}` });

    // Step reasoning history
    for (const step of runHistory) {
      messages.push({ role: 'assistant', content: step.thought_action });
      messages.push({ role: 'user', content: step.observation });
    }

    return messages;
  }

  _compileFallbackPrompt(query, runHistory) {
    let context = "";
    runHistory.forEach((step, idx) => {
      context += `\n--- Step ${idx + 1} ---\nObservation: ${step.observation || ''}\n`;
    });

    const promptStr = (
      "You have reached your maximum thinking steps. Formulate your final answer to the user's question now " +
      "based on the compiled context below. Follow all response format rules (Markdown, bold headings, etc.).\n\n" +
      `Question: ${query}\n\n` +
      `Retrieved Context:\n${context}\n\n` +
      "Final structured answer:"
    );

    return [
      { role: 'system', content: AGENT_SYSTEM_PROMPT },
      { role: 'user', content: promptStr }
    ];
  }

  async * streamRun(query, chatHistory = null) {
    this.runHistory = [];
    const runHistory = this.runHistory;

    for (let step = 0; step < this.maxSteps; step++) {
      const messages = this._compilePrompt(query, runHistory, chatHistory);

      // Yield step thinking indicator
      yield `data: ${JSON.stringify({ token: `🤖 **Step ${step + 1} Thinking...**  \n` })}\n\n`;

      let currentStepText = "";
      let isAnswerPrinted = false;

      try {
        for await (const token of this.llm.stream(messages)) {
          currentStepText += token;

          if (currentStepText.includes("Answer:") && !isAnswerPrinted) {
            const parts = currentStepText.split("Answer:", 2);
            isAnswerPrinted = true;
            yield `data: ${JSON.stringify({ token: '📚 **Answer:**  \n' + parts[1] })}\n\n`;
          } else if (isAnswerPrinted) {
            yield `data: ${JSON.stringify({ token })}\n\n`;
          } else {
            yield `data: ${JSON.stringify({ token })}\n\n`;
          }
        }
      } catch (err) {
        console.error(`[ReActAgent] Error in step ${step}:`, err);
        yield `data: ${JSON.stringify({ error: `LLM Generation Error: ${err.message}` })}\n\n`;
        return;
      }

      // Check if action requested
      const actionMatch = ACTION_REGEX.exec(currentStepText);
      if (actionMatch) {
        const toolName = actionMatch[1].trim();
        const toolArg = actionMatch[2].trim().replace(/^['"]|['"]$/g, '');

        yield `data: ${JSON.stringify({ token: `\n\n⚙️ **Executing Tool:** \`${toolName}(${toolArg})\`  \n` })}\n\n`;

        const observation = await this.executeTool(toolName, toolArg);

        // Preview observation preview
        yield `data: ${JSON.stringify({ token: `📝 **Observation:**  \n${observation.slice(0, 400)}... [Truncated for preview]  \n\n` })}\n\n`;

        runHistory.push({
          thought_action: currentStepText,
          observation: observation
        });
      } else {
        if (isAnswerPrinted || currentStepText.includes("Answer:")) {
          const intent = this.detectIntent(query);
          yield `data: ${JSON.stringify({ intent, done: true })}\n\n`;
          return;
        } else {
          // Fallback wrapper if formatting was slightly missed
          const intent = this.detectIntent(query);
          yield `data: ${JSON.stringify({ intent, done: true })}\n\n`;
          return;
        }
      }
    }

    // Exhausted steps
    yield `data: ${JSON.stringify({ token: '\n\n⚠️ *Agent reached maximum reasoning limit. Compiling final answers...*  \n' })}\n\n`;

    const fallbackPrompt = this._compileFallbackPrompt(query, runHistory);
    try {
      for await (const token of this.llm.stream(fallbackPrompt)) {
        yield `data: ${JSON.stringify({ token })}\n\n`;
      }
    } catch (err) {
      yield `data: ${JSON.stringify({ error: `LLM Fallback Generation Error: ${err.message}` })}\n\n`;
    }

    const intent = this.detectIntent(query);
    yield `data: ${JSON.stringify({ intent, done: true })}\n\n`;
  }

  async run(query, chatHistory = null) {
    const runHistory = [];

    for (let step = 0; step < this.maxSteps; step++) {
      const messages = this._compilePrompt(query, runHistory, chatHistory);
      try {
        const response = await this.llm.invoke(messages);
        const responseText = response.content || "";

        const actionMatch = ACTION_REGEX.exec(responseText);
        if (actionMatch) {
          const toolName = actionMatch[1].trim();
          const toolArg = actionMatch[2].trim().replace(/^['"]|['"]$/g, '');
          const observation = await this.executeTool(toolName, toolArg);

          runHistory.push({
            thought_action: responseText,
            observation: observation
          });
        } else {
          let answer = responseText.trim();
          if (responseText.includes("Answer:")) {
            const parts = responseText.split("Answer:", 2);
            answer = parts[1].trim();
          }
          return {
            answer: answer,
            sources: this.extractSources(runHistory),
            intent: this.detectIntent(query)
          };
        }
      } catch (err) {
        console.error(`[ReActAgent] Error in sync run step ${step}:`, err);
        break;
      }
    }

    // Fallback if steps exceeded
    const fallbackPrompt = this._compileFallbackPrompt(query, runHistory);
    try {
      const response = await this.llm.invoke(fallbackPrompt);
      return {
        answer: response.content || "",
        sources: this.extractSources(runHistory),
        intent: this.detectIntent(query)
      };
    } catch (err) {
      return {
        answer: "Sorry, I was unable to complete the query.",
        sources: this.extractSources(runHistory),
        intent: this.detectIntent(query)
      };
    }
  }
}

module.exports = {
  ReActAgent,
  AgentTool
};
