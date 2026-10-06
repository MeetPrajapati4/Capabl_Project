import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Sparkles, Edit2, CopyPlus, Trash2, Copy, Check, FileText } from 'lucide-react';
import { Marked } from 'marked';

const markdownRenderer = new Marked({ breaks: true, gfm: true });

markdownRenderer.use({
  renderer: {
    code(token) {
      const rawLang = (token.lang || '').trim();
      const lang = rawLang || 'code';
      const codeText = token.text || '';
      const escapedCode = codeText
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

      return `<div class="chatgpt-code-container">
  <div class="chatgpt-code-header">
    <span class="chatgpt-code-lang">${lang.toUpperCase()}</span>
    <button type="button" class="chatgpt-code-copy-btn" title="Copy code" aria-label="Copy code">
      <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" height="13" width="13" xmlns="http://www.w3.org/2000/svg">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span>Copy code</span>
    </button>
  </div>
  <pre class="chatgpt-code-pre"><code class="language-${lang}">${escapedCode}</code></pre>
</div>`;
    }
  }
});

function cleanResponseText(text) {
  if (!text) return '';
  let cleaned = text
    // Strip mojibake / broken encoding
    .replace(/\u00C3[\u0080-\u00FF]/g, '')
    .replace(/\u00E2\u0080[\u0080-\u00FF]/g, '')
    .replace(/[\u00C0-\u00FF](?![a-zA-Z0-9])/g, ' ')
    .replace(/[\u200B-\u200F\u2028-\u202F\u2060-\u2069\uFEFF]/g, '')
    // Strip redundant "📚 Answer:", "**Answer:**", or "Answer:" header prefixes
    .replace(/^(\s*📚\s*)?(\*\*)?Answer:?(\*\*)?\s*/i, '')
    .trim();

  // If text contains a bare HTML document without code fences, wrap it cleanly
  if (!cleaned.includes('```') && /<!DOCTYPE html>|<html[\s>]/i.test(cleaned)) {
    cleaned = cleaned.replace(/(<!DOCTYPE html>[\s\S]*)/i, '```html\n$1\n```');
  }

  // If there's an odd count of code fences (unclosed during streaming or generation), close it cleanly
  const fences = cleaned.match(/```/g);
  if (fences && fences.length % 2 !== 0) {
    cleaned += '\n```';
  }

  return cleaned;
}

function ObservationContent({ content }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = content.length > 200;
  const displayText = expanded ? content : (isLong ? `${content.slice(0, 200)}...` : content);

  return (
    <div className="observation-wrapper">
      <pre className="observation-pre">{displayText}</pre>
      {isLong && (
        <button 
          type="button"
          className="observation-toggle-btn cursor-pointer"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show Less' : 'Show Full Observation'}
        </button>
      )}
    </div>
  );
}

export default function AssistantMessage({
  message,
  content,
  sources = [],
  steps = [],
  followUps = [],
  onEdit,
  onDelete,
  onDuplicate,
  onSourceClick,
  onFollowUpClick,
  isTyping = false
}) {
  const rawText = content || message?.content || message?.text || '';
  const textContent = rawText.trim() 
    ? rawText 
    : (isTyping ? '' : "I'm ready to assist you with your academic study questions. Please ask anything or upload study documents.");
  const messageId = message?.id;

  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(textContent);
  const [stepsExpanded, setStepsExpanded] = useState(true);
  const bodyRef = useRef(null);

  const parsedContent = useMemo(() => {
    let clean = cleanResponseText(textContent);
    let html = markdownRenderer.parse(clean);

    if (isTyping && textContent.trim().length > 0) {
      if (/<\/p>\s*$/i.test(html)) {
        html = html.replace(/<\/p>\s*$/i, '<span class="typing-cursor" aria-hidden="true"></span></p>');
      } else if (/<\/code><\/pre>\s*<\/div>\s*$/i.test(html)) {
        html = html.replace(/<\/code><\/pre>\s*<\/div>\s*$/i, '<span class="typing-cursor code-cursor" aria-hidden="true"></span></code></pre></div>');
      } else {
        html += '<span class="typing-cursor" aria-hidden="true"></span>';
      }
    }
    return html;
  }, [textContent, isTyping]);

  useEffect(() => {
    setEditText(textContent);
  }, [textContent]);

  // Delegated copy button listener for rendered code containers
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const handleCopyClick = (e) => {
      const btn = e.target.closest('.chatgpt-code-copy-btn');
      if (!btn) return;
      e.stopPropagation();

      const container = btn.closest('.chatgpt-code-container');
      const codeEl = container ? container.querySelector('code') : null;
      const text = codeEl ? codeEl.innerText : '';

      navigator.clipboard.writeText(text).then(() => {
        btn.innerHTML = `
          <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" height="13" width="13" xmlns="http://www.w3.org/2000/svg">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <span>Copied!</span>
        `;
        btn.classList.add('copied');
        setTimeout(() => {
          btn.innerHTML = `
            <svg stroke="currentColor" fill="none" stroke-width="2" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" height="13" width="13" xmlns="http://www.w3.org/2000/svg">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy code</span>
          `;
          btn.classList.remove('copied');
        }, 2000);
      });
    };

    el.addEventListener('click', handleCopyClick);
    return () => el.removeEventListener('click', handleCopyClick);
  }, []);

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanResponseText(textContent));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    if (editText.trim() && editText.trim() !== textContent) {
      if (onEdit) onEdit(editText.trim());
      setIsEditing(false);
    } else {
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setEditText(textContent);
    setIsEditing(false);
  };

  if ((!textContent || !textContent.trim()) && isTyping) {
    return null;
  }

  return (
    <div className="chatgpt-assistant-msg-wrapper group">
      {/* ── 1. Assistant Identity Header ── */}
      <div className="chatgpt-assistant-header">
        <div className="chatgpt-avatar-tile">
          <Sparkles size={13} className="text-white" />
        </div>
        <span className="chatgpt-assistant-name">
          Askify AI
        </span>
        <span className="chatgpt-badge-pill">
          Academic Assistant
        </span>
      </div>

      {/* ── 2. Response Card (Full Width, ChatGPT Style) ── */}
      <div className="chatgpt-assistant-card">
        {isEditing ? (
          <div className="chatgpt-edit-mode">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="chatgpt-edit-textarea"
              rows={4}
              autoFocus
            />
            <div className="chatgpt-edit-actions">
              <button
                type="button"
                onClick={handleCancel}
                className="chatgpt-btn-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="chatgpt-btn-save"
              >
                Save Changes
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Agent Operations Trace Accordion if steps present */}
            {steps && steps.length > 0 && (
              <div className="agent-steps-accordion mb-3">
                <button 
                  type="button"
                  className={`agent-steps-header-btn ${stepsExpanded ? 'expanded' : ''} cursor-pointer`}
                  onClick={() => setStepsExpanded(!stepsExpanded)}
                  aria-expanded={stepsExpanded}
                >
                  <div className="agent-steps-header-title">
                    <span className="pulse-dot green" />
                    <span>Agent Operations Trace ({steps.length} actions)</span>
                  </div>
                  <span className="chevron-icon">{stepsExpanded ? '▼' : '▶'}</span>
                </button>
                
                {stepsExpanded && (
                  <div className="agent-steps-timeline">
                    {steps.map((step, idx) => (
                      <div key={idx} className={`agent-step-item ${step.type}`}>
                        <div className="agent-step-node">
                          <span className="agent-step-icon">{step.icon}</span>
                        </div>
                        <div className="agent-step-content-box">
                          <div className="agent-step-title">{step.title}</div>
                          {step.content && (
                            <div className="agent-step-body">
                              {step.type === 'tool' ? (
                                <pre className="terminal-pre"><code>{step.content}</code></pre>
                              ) : step.type === 'observation' ? (
                                <ObservationContent content={step.content} />
                              ) : (
                                <div className="thought-text">{step.content}</div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Markdown Body Text */}
            <div
              ref={bodyRef}
              className="chatgpt-msg-body"
              dangerouslySetInnerHTML={{ __html: parsedContent }}
            />

            {/* Source Citations Pill Row */}
            {sources && sources.length > 0 && (
              <div className="chatgpt-sources-row">
                <span className="chatgpt-sources-label">
                  Cited Sources:
                </span>
                {sources.map((src, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onSourceClick?.(src)}
                    className="chatgpt-source-pill cursor-pointer"
                  >
                    <FileText size={11} />
                    <span>{src}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Suggested Doctoral Follow-up Inquiries */}
            {followUps && followUps.length > 0 && !isTyping && (
              <div className="chatgpt-followups-row" role="region" aria-label="Suggested Research Follow-ups">
                <span className="chatgpt-followups-label">
                  <Sparkles size={12} /> Suggested Research Inquiries:
                </span>
                <div className="chatgpt-followups-list">
                  {followUps.map((question, qIdx) => (
                    <button
                      key={qIdx}
                      type="button"
                      className="chatgpt-followup-pill cursor-pointer"
                      onClick={() => onFollowUpClick?.(question)}
                      title="Investigate this research inquiry"
                    >
                      <span>{question}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── 3. ChatGPT Bottom Action Bar (Horizontal, Bottom-Left) ── */}
            {!isTyping && (
              <div className="chatgpt-assistant-footer">
                <button
                  type="button"
                  className={`chatgpt-footer-btn ${copied ? 'copied' : ''}`}
                  onClick={handleCopy}
                  title={copied ? "Copied to clipboard!" : "Copy response"}
                  aria-label="Copy response"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copied ? "Copied!" : "Copy"}</span>
                </button>

                <button
                  type="button"
                  className="chatgpt-footer-btn"
                  onClick={() => setIsEditing(true)}
                  title="Edit response"
                  aria-label="Edit response"
                >
                  <Edit2 size={13} />
                  <span>Edit</span>
                </button>

                {onDuplicate && (
                  <button
                    type="button"
                    className="chatgpt-footer-btn"
                    onClick={() => onDuplicate(messageId)}
                    title="Duplicate message"
                    aria-label="Duplicate message"
                  >
                    <CopyPlus size={13} />
                    <span>Duplicate</span>
                  </button>
                )}

                {onDelete && (
                  <button
                    type="button"
                    className="chatgpt-footer-btn delete"
                    onClick={onDelete}
                    title="Delete message"
                    aria-label="Delete message"
                  >
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
