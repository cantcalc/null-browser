import React, { useState, useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown, X, Search } from 'lucide-react';

interface FindBarProps {
  isOpen: boolean;
  onClose: () => void;
  onFind: (text: string, forward: boolean) => void;
  matchIndex: number;
  matchTotal: number;
}

export const FindBar: React.FC<FindBarProps> = ({
  isOpen,
  onClose,
  onFind,
  matchIndex,
  matchTotal,
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    } else {
      setQuery('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    onFind(val, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onFind(query, !e.shiftKey);
    }
  };

  return (
    <div className="null-find-row flex h-10 shrink-0 items-center justify-end bg-[var(--chrome-bg)] px-3">
    <div className="find-bar null-popover relative z-40 flex max-w-full items-center gap-1 p-1 text-xs select-none">
      <div className="find-bar-query null-field flex min-w-0 flex-1 items-center gap-1.5 px-2 h-7">
        <Search className="w-3 h-3 text-[var(--text-muted)]" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="검색"
          className="min-w-0 w-auto flex-1 bg-transparent text-[var(--text-primary)] outline-none text-xs"
        />
        {query && (
          <span className="shrink-0 text-[10px] text-[var(--text-muted)] font-mono">
            {matchTotal > 0 ? `${matchIndex}/${matchTotal}` : '0/0'}
          </span>
        )}
      </div>

      <button
        onClick={() => onFind(query, false)}
        disabled={!query}
        title="이전 결과 (Shift+Enter)"
        className="null-icon-button !h-7 !w-7 disabled:opacity-30"
      >
        <ChevronUp className="w-3.5 h-3.5" />
      </button>

      <button
        onClick={() => onFind(query, true)}
        disabled={!query}
        title="다음 결과 (Enter)"
        className="null-icon-button !h-7 !w-7 disabled:opacity-30"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      <button
        onClick={onClose}
        title="닫기 (ESC)"
        className="null-icon-button !h-7 !w-7"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
    </div>
  );
};
