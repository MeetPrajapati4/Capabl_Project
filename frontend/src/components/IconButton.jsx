import React, { useState } from 'react';

export default function IconButton({
  icon: Icon,
  label,
  tooltip,
  onClick,
  variant = 'default',
  active = false,
  className = '',
  disabled = false,
  ariaLabel,
  size = 15
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative inline-flex items-center justify-center">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        aria-label={ariaLabel || label || tooltip}
        className={`askify-action-btn ${active ? 'copied active' : ''} ${variant === 'danger' ? 'danger' : ''} ${className}`}
      >
        <Icon size={size} strokeWidth={2} />
      </button>

      {/* Accessible Tooltip */}
      {tooltip && showTooltip && (
        <div role="tooltip" className="askify-tooltip">
          {tooltip}
        </div>
      )}
    </div>
  );
}
