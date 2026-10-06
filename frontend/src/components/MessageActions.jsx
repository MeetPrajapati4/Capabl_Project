import React from 'react';
import { Edit2, CopyPlus, Trash2, Copy, Check } from 'lucide-react';
import IconButton from './IconButton';

export default function MessageActions({
  direction = 'horizontal',
  onEdit,
  onDuplicate,
  onDelete,
  onCopy,
  copied = false,
  showEdit = true,
  showDuplicate = true,
  showDelete = true,
  showCopy = true,
  className = ''
}) {
  const containerClasses = direction === 'vertical'
    ? 'flex flex-col gap-1.5'
    : 'flex items-center gap-1.5';

  return (
    <div 
      className={className} 
      style={{
        display: 'flex',
        flexDirection: direction === 'vertical' ? 'column' : 'row',
        alignItems: 'center',
        gap: '6px'
      }}
      role="toolbar" 
      aria-label="Message action controls"
    >
      {showEdit && onEdit && (
        <IconButton
          icon={Edit2}
          label="Edit"
          tooltip="Edit message"
          onClick={onEdit}
        />
      )}

      {showDuplicate && onDuplicate && (
        <IconButton
          icon={CopyPlus}
          label="Duplicate"
          tooltip="Duplicate message"
          onClick={onDuplicate}
        />
      )}

      {showDelete && onDelete && (
        <IconButton
          icon={Trash2}
          label="Delete"
          tooltip="Delete message"
          variant="danger"
          onClick={onDelete}
        />
      )}

      {showCopy && onCopy && (
        <IconButton
          icon={copied ? Check : Copy}
          label={copied ? "Copied" : "Copy"}
          tooltip={copied ? "Copied to clipboard!" : "Copy message"}
          active={copied}
          onClick={onCopy}
        />
      )}
    </div>
  );
}
