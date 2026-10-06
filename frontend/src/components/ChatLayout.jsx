import React, { useState } from 'react';
import { Send, RotateCcw, Sparkles } from 'lucide-react';
import ThemeToggle from './ThemeToggle';
import AssistantMessage from './AssistantMessage';
import UserMessage from './UserMessage';

export default function ChatLayout({
  messages = [],
  onSendMessage,
  onUpdateMessage,
  onDeleteMessage,
  onDuplicateMessage,
  onResetChat,
  isDark,
  onToggleTheme,
  children
}) {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputValue.trim()) return;
    if (onSendMessage) onSendMessage(inputValue.trim());
    setInputValue('');
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col items-center justify-between overflow-hidden bg-slate-50 dark:bg-[#080a14] transition-colors duration-300">
      
      {/* ── Atmospheric Ambient Background Glows ── */}
      {/* Top-Left Ambient Purple Glow */}
      <div 
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -left-24 w-[34rem] h-[34rem] rounded-full blur-[110px] transition-all duration-700
          bg-purple-300/30 dark:bg-purple-700/20"
      />
      {/* Top-Right Ambient Cyan/Blue Glow */}
      <div 
        aria-hidden="true"
        className="pointer-events-none absolute -top-28 -right-28 w-[36rem] h-[36rem] rounded-full blur-[130px] transition-all duration-700
          bg-sky-300/30 dark:bg-blue-600/18"
      />

      {/* ── Top Header / Control Bar ── */}
      <header className="relative z-10 w-full max-w-4xl px-4 sm:px-6 pt-5 pb-3 flex items-center justify-between border-b border-slate-200/60 dark:border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-white shadow-sm shadow-purple-500/30">
            <Sparkles size={14} />
          </div>
          <span className="font-semibold text-base tracking-tight text-slate-900 dark:text-white">
            Askify AI
          </span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 dark:border dark:border-purple-500/20 font-medium">
            Academic Studio
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          {onResetChat && (
            <button
              type="button"
              onClick={onResetChat}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer transition-all duration-200
                border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100 shadow-sm
                dark:border-white/10 dark:text-slate-300 dark:hover:text-white dark:hover:bg-white/10"
              title="Reset to default screenshot state"
            >
              <RotateCcw size={12} />
              <span>Reset</span>
            </button>
          )}

          <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
        </div>
      </header>

      {/* ── Main Conversation Stream ── */}
      <main className="relative z-10 w-full max-w-4xl flex-1 px-4 sm:px-6 py-6 sm:py-10 flex flex-col justify-start gap-8 overflow-y-auto">
        {children ? (
          children
        ) : (
          messages.map((msg, i) => (
            msg.role === 'user' ? (
              <UserMessage
                key={msg.id || i}
                message={msg}
                onEdit={(newText) => onUpdateMessage?.(msg.id || i, newText)}
                onDelete={() => onDeleteMessage?.(msg.id || i)}
                onDuplicate={() => onDuplicateMessage?.(msg.id || i)}
              />
            ) : (
              <AssistantMessage
                key={msg.id || i}
                message={msg}
                onEdit={(newText) => onUpdateMessage?.(msg.id || i, newText)}
                onDelete={() => onDeleteMessage?.(msg.id || i)}
                onDuplicate={() => onDuplicateMessage?.(msg.id || i)}
              />
            )
          ))
        )}
      </main>

      {/* ── Bottom Interactive Input Composer ── */}
      {onSendMessage && (
        <footer className="relative z-10 w-full max-w-4xl px-4 sm:px-6 pb-6 pt-2">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask a question or analyze study material..."
              className="
                w-full py-3.5 pl-4 pr-12 rounded-2xl text-[14px] transition-all duration-200 border
                bg-white text-slate-900 border-slate-200/90 shadow-sm placeholder:text-slate-400
                dark:bg-[#0c1021]/80 dark:text-white dark:border-white/10 dark:placeholder:text-slate-500
                focus:outline-none focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-500/70
                backdrop-blur-md
              "
            />
            <button
              type="submit"
              disabled={!inputValue.trim()}
              aria-label="Send message"
              className="
                absolute right-2.5 p-2 rounded-xl text-white transition-all duration-200 cursor-pointer
                bg-purple-600 hover:bg-purple-700 disabled:opacity-30 disabled:hover:bg-purple-600 disabled:cursor-not-allowed
                focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 active:scale-95
              "
            >
              <Send size={15} />
            </button>
          </form>
          <p className="text-center text-[11px] text-slate-400 dark:text-slate-600 mt-2">
            Askify Academic Engine • Verified Nemotron-3 Architecture
          </p>
        </footer>
      )}

    </div>
  );
}
