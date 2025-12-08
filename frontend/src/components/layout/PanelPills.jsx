import React from "react";
import classNames from "../../utils/classNames";

export default function PanelPills({ className = "", panels = [], onSelect, onClose }) {
  if (!panels.length) return null;

  return (
    <div className={classNames("header-panel-pills overflow-x-auto", className)}>
      {panels.map((panel) => (
        <button
          key={panel.id}
          type="button"
          className="header-panel-pill"
          title={`Show ${panel.title}`}
          onClick={() => onSelect?.(panel.component)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            paddingRight: 8,
          }}
        >
          <span className="header-panel-pill-label" style={{ whiteSpace: "nowrap" }}>
            {panel.title}
          </span>
          <span
            role="button"
            aria-label={`Close ${panel.title}`}
            className="header-panel-pill-close"
            onClick={(event) => {
              event.stopPropagation();
              onClose?.(panel.component);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
              fontSize: 12,
              background: "transparent",
              width: 16,
              height: 16,
              borderRadius: 999,
            }}
          >
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
