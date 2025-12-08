import React, { useState } from "react";

import {
  IconNewChat,
  IconChatHistory,
  IconSearchChat,
  IconNotifications,
  IconTasks,
  IconGovernance,
  IconLedger,
  IconWorkflows,
  IconMVP,
  IconPinnedPanels,
} from "../icons";

const buttons = [
  { key: "new", icon: IconNewChat, label: "New chat" },
  { key: "history", icon: IconChatHistory, label: "Chat history" },
  { key: "search", icon: IconSearchChat, label: "Search chat" },
  { key: "notifications", icon: IconNotifications, label: "Notifications" },
  { key: "tasks", icon: IconTasks, label: "Tasks" },
  { key: "governance", icon: IconGovernance, label: "Runtime Governance" },
  { key: "ledger", icon: IconLedger, label: "Ledger" },
  { key: "workflows", icon: IconWorkflows, label: "Workflows" },
  { key: "mvp", icon: IconMVP, label: "MVP" },
  { key: "pinned", icon: IconPinnedPanels, label: "Pinned panels" },
];

export default function ChatToolbar({ onToggleHistory, isHistoryOpen, onNewChat, onOpenPanel, className = "", style }) {
  const [activeKey, setActiveKey] = useState(null);

  return (
    <aside className={`chat-toolbar ${className}`} style={style}>
      {buttons.map(({ key, icon: Icon }) => {
        const isActive = key === "history" ? isHistoryOpen : activeKey === key;
        const handleClick = () => {
          if (key === "history") {
            onToggleHistory?.();
            return;
          }
          if (key === "new") {
            onNewChat?.();
            setActiveKey(null);
            return;
          }
          setActiveKey((prev) => (prev === key ? null : key));
          if (key === "governance") onOpenPanel?.("governance");
          if (key === "ledger") onOpenPanel?.("ledger");
          if (key === "tasks") onOpenPanel?.("rules");
          if (key === "workflows") onOpenPanel?.("govControls");
          if (key === "mvp") onOpenPanel?.("mvp");
          if (key === "pinned") onOpenPanel?.("archivedLedger");
        };
        return (
          <button
            key={key}
            className={`${isActive ? "active" : ""} text-cdai-text transition rounded-none`}
            onClick={handleClick}
            title={key}
            style={{
              width: 36,
              height: 36,
              color: isActive ? "#007aff" : "#a1a1a1",
              background: "transparent",
              border: "none",
              borderRadius: 8,
              opacity: isActive ? 1 : 0.9,
            }}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </aside>
  );
}
