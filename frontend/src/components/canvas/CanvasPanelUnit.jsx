import React, { useMemo, useState } from "react";
import { panelRegistry } from "../../panels/panelRegistry";

const toTitleCase = (value) =>
  (value || "")
    .replace(/[-_]/g, " ")
    .replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1));

export default function CanvasPanelUnit({ panel, onClose, onSwap, onReorder, gridArea }) {
  const [dragOver, setDragOver] = useState(false);
  const headerTitle = useMemo(() => {
    if (panel?.title) return panel.title;
    if (panel?.component) return toTitleCase(panel.component);
    if (panel?.id) return toTitleCase(String(panel.id));
    return "Panel";
  }, [panel]);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const hiddenId = e.dataTransfer.getData("hiddenPanelId");
    const visibleId = e.dataTransfer.getData("visiblePanelId");
    if (hiddenId) {
      onSwap?.(hiddenId, panel.id);
    } else if (visibleId && visibleId !== panel.id) {
      onReorder?.(visibleId, panel.id);
    }
  };

  return (
    <div
      className="canvas-panel-unit rounded-cdai border border-cdai-border"
      style={{
        gridArea: gridArea || undefined,
        boxShadow: dragOver ? "0 0 0 2px #007aff inset" : "none",
        background: "#171717",
        borderColor: "#262626",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div
        className="canvas-panel-header rounded-t-cdai"
        style={{
          borderBottom: "1px solid #262626",
          background: "#0a0a0a",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "Arimo, sans-serif",
          fontSize: 13,
          color: "#e5e5e5",
        }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("visiblePanelId", panel.id);
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", color: "#a1a1a1" }}>
            <svg
              width={14}
              height={14}
              viewBox="0 0 14 14"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ display: "block" }}
            >
            <path d="M3.5 2.5H10.5" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" />
            <path d="M3.5 7H10.5" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" />
            <path d="M3.5 11.5H10.5" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" />
          </svg>
        </span>
        <span>{headerTitle}</span>
      </span>
        <button
          className="icon-button text-cdai-text opacity-80 hover:opacity-100 transition rounded-none"
          onClick={onClose}
          aria-label="Close panel"
          style={{
            background: "#26262680",
            border: "1px solid #262626",
            borderRadius: 6,
            color: "#a1a1a1",
            width: 24,
            height: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
          }}
        >
          <svg
            width={12}
            height={12}
            viewBox="0 0 14 14"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ display: "block" }}
          >
            <path d="M3.5 3.5L10.5 10.5" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" />
            <path d="M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div
        className="canvas-panel-body rounded-b-cdai text-cdai-text"
        style={{
          background: "#171717",
          color: "#e0e0e0",
          padding: 14,
          fontFamily: "Arimo, sans-serif",
          fontSize: 13,
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          minHeight: 0,
          maxHeight: "100%",
          overflowY: "auto",
        }}
      >
        {panel.component && panelRegistry[panel.component]
          ? React.createElement(panelRegistry[panel.component])
          : panel.content}
      </div>
    </div>
  );
}
