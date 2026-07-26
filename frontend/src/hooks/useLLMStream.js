import { useState, useRef, useCallback } from 'react';

/**
 * A production-ready custom React hook for streaming LLM responses using SSE.
 * Encapsulates the Web fetch and ReadableStream reader loop with abort safety.
 */
export function useLLMStream() {
  const [isGenerating, setIsGenerating] = useState(false);
  const activeControllerRef = useRef(null);

  const startStream = useCallback(async (query, { onToken, onDone, onError }) => {
    setIsGenerating(true);
    const controller = new AbortController();
    activeControllerRef.current = controller;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errMsg = `Error ${response.status}`;
        try {
          const errData = await response.json();
          errMsg = errData.error || errMsg;
        } catch {
          // Response wasn't JSON
        }
        throw new Error(errMsg);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // save incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.substring(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);

            if (data.error) {
              throw new Error(data.error);
            }

            if (data.token) {
              onToken(data.token);
            }

            if (data.done) {
              onDone(data);
            }
          } catch (parseErr) {
            // Re-throw errors coming from data.error
            if (parseErr.message && !parseErr.message.includes('JSON')) {
              throw parseErr;
            }
            // Skip malformed JSON lines
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        onError(err);
      }
    } finally {
      setIsGenerating(false);
      activeControllerRef.current = null;
    }
  }, []);

  const cancelStream = useCallback(() => {
    if (activeControllerRef.current) {
      activeControllerRef.current.abort();
    }
    setIsGenerating(false);
  }, []);

  return { isGenerating, startStream, cancelStream };
}
