import React from "react";

export default function ChatHistorySearch({ value, onChange }) {
  return (
    <div className="chat-history-search">
      <span className="chat-history-search-icon" style={{ display: "inline-flex" }}>
        <svg
          width={16}
          height={16}
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ color: "#a1a1a1" }}
        >
          <path
            d="M6.41522 11.0778C8.98347 11.0778 11.0695 8.9918 11.0695 6.42355C11.0695 3.8553 8.98347 1.76929 6.41522 1.76929C3.84697 1.76929 1.76096 3.8553 1.76096 6.42355C1.76096 8.9918 3.84697 11.0778 6.41522 11.0778Z"
            stroke="currentColor"
            strokeWidth="1.16609"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12.2352 12.2437L9.71387 9.72241"
            stroke="currentColor"
            strokeWidth="1.16609"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <input
        className="chat-history-search-input bg-cdai-input text-cdai-text border border-cdai-border focus:ring-cdai-accent"
        placeholder="Search chats..."
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  );
}
