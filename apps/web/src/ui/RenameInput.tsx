import { useState } from 'react';

/** The tree renames in place; committing happens on Enter or on blur. */
export function RenameInput({
  label,
  value,
  onCommit,
  onCancel,
}: {
  label: string;
  value: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else onCancel();
  };
  return (
    <input
      className="tree-rename"
      aria-label={label}
      value={draft}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
    />
  );
}
