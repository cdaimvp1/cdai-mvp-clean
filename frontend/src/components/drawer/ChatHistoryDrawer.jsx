import React from "react";
import classNames from "../../utils/classNames";
import ChatHistorySearch from "./ChatHistorySearch";
import ChatHistoryItem from "./ChatHistoryItem";

export default function ChatHistoryDrawer({ open, onClose, items = [] }) {
  const list =
    items.length > 0
      ? items
      : [
          { id: 1, title: "Q4 Revenue Analysis", timestamp: "Dec 3 2:30 PM" },
          { id: 2, title: "Marketing Campaign Strategy", timestamp: "Dec 3 10:15 AM" },
          { id: 3, title: "Product Roadmap Discussion", timestamp: "Dec 2 4:45 PM" },
          { id: 4, title: "Customer Feedback Review", timestamp: "Dec 2 9:20 AM" },
          { id: 5, title: "Team Performance Metrics", timestamp: "Dec 1 3:10 PM" },
          { id: 6, title: "Budget Planning 2025", timestamp: "Dec 1 11:30 AM" },
        ];

  return (
    <div
      className={classNames("chat-history-drawer bg-cdai-chathistory text-cdai-text", open && "open")}
    >
      <div className="chat-history-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span>Chat History</span>
        <button
          aria-label="Add chat"
          className="icon-button"
          style={{
            width: 24,
            height: 24,
            color: "#a1a1a1",
            background: "transparent",
            border: "none",
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
            <path d="M7 2.33337V11.6667" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2.33301 7H11.6663" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <ChatHistorySearch />
      <div className="chat-history-list">
        {list.map((item) => (
          <ChatHistoryItem
            key={item.id}
            title={item.title}
            timestamp={item.timestamp}
            onClick={onClose}
          />
        ))}
      </div>
    </div>
  );
}
