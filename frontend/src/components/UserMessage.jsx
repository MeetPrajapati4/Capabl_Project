import React, { useState } from 'react';
import { Edit2, Copy, CopyPlus, Trash2, Check, Send, X } from 'lucide-react';

export default function UserMessage({ message, content, onEdit, onDelete, onDuplicate }) {
  const textContent = content || message?.content || message?.text || '';
  const messageId = message?.id;

  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(textContent);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(textContent);
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

  return (
    <div className="chatgpt-user-msg-wrapper group">
      {isEditing ? (
        <div className="chatgpt-user-edit-box">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="chatgpt-user-textarea"
            rows={Math.max(2, editText.split('\n').length)}
            autoFocus
          />
          <div className="chatgpt-user-edit-actions">
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
              Save & Submit
            </button>
          </div>
        </div>
      ) : (
        <div className="chatgpt-user-bubble">
          {textContent}
        </div>
      )}

      {/* ChatGPT-Style User Actions (Horizontal toolbar beneath bubble on hover) */}
      {!isEditing && (
        <div className="chatgpt-user-toolbar">
          <button
            type="button"
            className="chatgpt-toolbar-btn"
            onClick={() => setIsEditing(true)}
            title="Edit question"
            aria-label="Edit question"
          >
            <Edit2 size={13} />
          </button>

          <button
            type="button"
            className={`chatgpt-toolbar-btn ${copied ? 'success' : ''}`}
            onClick={handleCopy}
            title={copied ? 'Copied!' : 'Copy question'}
            aria-label="Copy question"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>

          {onDuplicate && (
            <button
              type="button"
              className="chatgpt-toolbar-btn"
              onClick={() => onDuplicate(messageId)}
              title="Duplicate question"
              aria-label="Duplicate question"
            >
              <CopyPlus size={13} />
            </button>
          )}

          {onDelete && (
            <button
              type="button"
              className="chatgpt-toolbar-btn delete"
              onClick={onDelete}
              title="Delete question"
              aria-label="Delete question"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
