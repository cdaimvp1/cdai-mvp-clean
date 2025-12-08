import React, { useEffect, useMemo, useState } from "react";

export default function CommandPaletteModal({ open, onClose, commands = [] }) {
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlightedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const filteredCommands = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return commands;
    return commands.filter((cmd) => cmd.label.toLowerCase().includes(normalizedQuery));
  }, [commands, query]);

  const handleSelect = (command) => {
    if (!command) return;
    command.action?.();
    onClose?.();
  };

  if (!open) return null;

  return (
    <div className="command-palette-overlay" role="dialog" aria-modal="true" onClick={() => onClose?.()}>
      <div
        className="command-palette-container"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="command-palette-input"
          placeholder="Type a command..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlightedIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightedIndex((prev) => Math.min(prev + 1, Math.max(filteredCommands.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightedIndex((prev) => Math.max(prev - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              handleSelect(filteredCommands[highlightedIndex]);
            }
          }}
        />
        <div className="command-palette-list" role="listbox">
          {filteredCommands.length === 0 && (
            <div className="command-palette-empty">No commands match "{query}".</div>
          )}
          {filteredCommands.map((command, index) => {
            const isActive = index === highlightedIndex;
            return (
              <button
                key={command.id}
                type="button"
                className={`command-palette-item${isActive ? " active" : ""}`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => handleSelect(command)}
              >
                {command.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
