import React from "react";
import ChatToolbar from "../chat/ChatToolbar";

export default function Sidebar({ onToggleHistory, isHistoryOpen, onNewChat, onOpenPanel }) {
  return (
    <div
      className="sidebar-container"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 56,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        paddingTop: 16,
        gap: 12,
        zIndex: 10,
        background: "transparent",
      }}
    >
      <ChatToolbar onToggleHistory={onToggleHistory} isHistoryOpen={isHistoryOpen} onNewChat={onNewChat} onOpenPanel={onOpenPanel} />
    </div>
  );
}
