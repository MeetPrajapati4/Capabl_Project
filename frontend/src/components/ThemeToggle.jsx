import React, { useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle({ isDark, onToggle, className = '' }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className={`relative inline-flex items-center ${className}`}>
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        className="
          relative inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-medium cursor-pointer
          transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500
          bg-white/80 border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 shadow-sm
          dark:bg-[#12162a]/90 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white
        "
      >
        {isDark ? (
          <>
            <Sun size={14} className="text-amber-400 transition-transform duration-300 hover:rotate-45" />
            <span className="hidden sm:inline">Light Mode</span>
          </>
        ) : (
          <>
            <Moon size={14} className="text-purple-600 transition-transform duration-300" />
            <span className="hidden sm:inline">Dark Mode</span>
          </>
        )}
      </button>

      {showTooltip && (
        <div
          role="tooltip"
          className="
            absolute z-50 px-2.5 py-1 text-xs font-medium rounded-md shadow-lg pointer-events-none whitespace-nowrap
            animate-fade-in -top-8 left-1/2 -translate-x-1/2
            bg-slate-900 text-white border border-slate-700
            dark:bg-slate-800 dark:text-slate-100 dark:border-slate-700
          "
        >
          {`Switch to ${isDark ? 'light' : 'dark'} mode`}
          <div className="absolute left-1/2 -bottom-1 -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-800" />
        </div>
      )}
    </div>
  );
}
