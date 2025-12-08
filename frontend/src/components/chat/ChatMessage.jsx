import React from "react";
import classNames from "../../utils/classNames";

export default function ChatMessage({ className, children }) {
  return <div className={classNames("chat-message", className)}>{children}</div>;
}
