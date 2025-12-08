import React from "react";

export default function ChatHistoryItem({ title, timestamp, onClick }) {
  return (
    <div
      className="chat-history-item bg-cdai-chathistory border border-cdai-border text-cdai-text"
      onClick={onClick}
    >
      <div className="chat-history-item-title">{title}</div>
      {timestamp ? <div className="chat-history-item-sub">{timestamp}</div> : null}
      <div className="chat-history-item-caret">
        <svg
          width={10}
          height={10}
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: "block", color: "#a1a1a1" }}
        >
          <path
            d="M5.25 3.5L9 7L5.25 10.5"
            stroke="currentColor"
            strokeWidth="1.16667"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
