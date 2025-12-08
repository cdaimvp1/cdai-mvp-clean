import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSend, IconVoice } from "../icons";

export default function ChatInputBar({
  onSend,
  pendingClarification,
  onSubmitClarification,
  disableChat,
  inputRef,
}) {
  const [text, setText] = useState("");
  const [clarificationText, setClarificationText] = useState("");
  const [voiceActive, setVoiceActive] = useState(false);
  const [inputScrollable, setInputScrollable] = useState(false);
  const messageInputRef = useRef(null);
  const clarificationInputRef = useRef(null);
  const maxHeightRef = useRef(0);

  const assignMessageInput = useCallback(
    (node) => {
      messageInputRef.current = node;
      if (typeof inputRef === "function") {
        inputRef(node);
      } else if (inputRef && typeof inputRef === "object") {
        // eslint-disable-next-line no-param-reassign
        inputRef.current = node;
      }
    },
    [inputRef]
  );

  const clampHeight = useCallback(() => {
    const el = messageInputRef.current;
    if (!el) return;
    const viewportLimit = Math.max(160, Math.floor((window?.innerHeight || 900) * 0.33));
    maxHeightRef.current = viewportLimit;
    el.style.height = "auto";
    const nextHeight = Math.min(viewportLimit, el.scrollHeight);
    el.style.height = `${nextHeight}px`;
    const shouldScroll = el.scrollHeight > viewportLimit;
    el.style.overflowY = shouldScroll ? "auto" : "hidden";
    setInputScrollable(shouldScroll);
  }, []);

  useEffect(() => {
    clampHeight();
  }, [clampHeight, text, pendingClarification]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleResize = () => clampHeight();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [clampHeight]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || disableChat) return;
    try {
      await onSend?.(trimmed);
    } finally {
      setText("");
      clampHeight();
    }
  };

  const handleClarification = () => {
    const trimmed = clarificationText.trim();
    if (!trimmed) return;
    onSubmitClarification?.(trimmed);
    setClarificationText("");
    clarificationInputRef.current?.focus();
  };

  const sharedTextareaStyle = useMemo(
    () => ({
      flex: 1,
      background: "#111111",
      borderRadius: 12,
      border: "1px solid #2d2d2d",
      color: "#ffffff",
      minHeight: 48,
      maxHeight: maxHeightRef.current ? `${maxHeightRef.current}px` : "33vh",
      padding: "10px 14px",
      fontFamily: "Arimo, sans-serif",
      lineHeight: 1.4,
      resize: "none",
    }),
    []
  );

  return (
    <div
      className="chat-input-bar text-cdai-text"
      style={{
        background: "transparent",
        border: "none",
        display: "flex",
        alignItems: pendingClarification ? "center" : "flex-end",
        gap: 8,
        minHeight: 44,
        padding: "8px 0 0",
        marginTop: 12,
      }}
    >
      {pendingClarification ? (
        <>
          <textarea
            ref={clarificationInputRef}
            className="chat-input focus:ring-cdai-accent"
            style={{
              ...sharedTextareaStyle,
              minHeight: 48,
              maxHeight: "40vh",
            }}
            placeholder="Provide clarification to continue..."
            value={clarificationText}
            onChange={(e) => setClarificationText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleClarification();
              }
            }}
          />
          <button
            className="icon-button"
            style={{
              width: 120,
              height: 48,
              background: "#0ea5e9",
              borderRadius: 10,
              border: "1px solid #2d2d2d",
              color: "#ffffff",
              fontWeight: 600,
            }}
            onClick={handleClarification}
            aria-label="Submit Clarification"
          >
            Submit Clarification
          </button>
        </>
      ) : (
        <>
          <textarea
            ref={assignMessageInput}
            className="chat-input focus:ring-cdai-accent"
            style={{
              ...sharedTextareaStyle,
              overflowY: inputScrollable ? "auto" : "hidden",
            }}
            placeholder="Type a message or drop files here..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={disableChat}
          />
          <button
            className="icon-button"
            style={{
              width: 44,
              height: 44,
              background: voiceActive ? "#ff3b30" : "#737373",
              borderRadius: 10,
              border: "1px solid #2d2d2d",
              color: "#ffffff",
            }}
            aria-label="Voice"
            onClick={() => setVoiceActive((v) => !v)}
            disabled={disableChat}
          >
            <IconVoice />
          </button>
          <button
            className="icon-button"
            style={{
              width: 44,
              height: 44,
              background: disableChat ? "#555" : "#007aff",
              borderRadius: 10,
              border: "1px solid #2d2d2d",
              color: "#ffffff",
            }}
            onClick={handleSend}
            aria-label="Send"
            disabled={disableChat}
          >
            <IconSend />
          </button>
        </>
      )}
    </div>
  );
}
