import React from "react";
import { getParticipantColor, systemColor, assistantColor } from "../../utils/chatColors";
import classNames from "../../utils/classNames";

export default function ChatMessagesList({ messages }) {
  return (
    <div className="chat-messages">
      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const isSystem = msg.role === "system";
        const isAssistant = msg.role === "assistant";
        const bubbleClass = classNames("chat-message rounded-cdai text-cdai-text");
        let style = {
          padding: "12px 14px",
          fontFamily: "Arimo, sans-serif",
          fontSize: 13,
        };
        if (isAssistant) {
          style = { ...style, background: "#f3f4f6", color: "#0b0b0b", border: "1px solid #e5e7eb" };
        } else if (!isUser && !isSystem) {
          style = { ...style, background: getParticipantColor(msg.author || msg.role), color: "#0b1220" };
        } else if (isSystem) {
          style = { ...style, background: systemColor, color: "#cbd5e1" };
        } else if (isUser) {
          style = { ...style, background: "#007aff", color: "#ffffff", alignSelf: "flex-end" };
        }
        const author = msg.author || msg.role;
        const dateObj = msg.timestamp ? new Date(msg.timestamp) : new Date();
        const dateStr = dateObj.toLocaleDateString("en-US");
        const timeStr = dateObj.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
        const align = isUser ? "flex-end" : "flex-start";
        return (
          <div
            key={msg.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              alignItems: align,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9, padding: "0 2px" }}>{author}</div>
            <div className={bubbleClass} style={{ ...style, alignSelf: "unset" }}>
              <div style={{ lineHeight: 1.45 }}>{msg.text}</div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.75, padding: "0 2px" }}>
              {dateStr} · {timeStr}
            </div>
          </div>
        );
      })}
    </div>
  );
}
