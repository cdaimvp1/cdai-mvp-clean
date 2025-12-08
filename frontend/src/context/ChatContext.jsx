import React, { createContext, useContext, useState, useCallback } from "react";

const ChatContext = createContext({
  messages: [],
  sendMessage: () => {},
});

export function ChatProvider({ children }) {
  const [messages, setMessages] = useState([]);

  const sendMessage = useCallback((text) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: "user", author: "You", text, timestamp: Date.now() },
    ]);
    // TODO: integrate governed workflow engine
  }, []);

  return (
    <ChatContext.Provider value={{ messages, sendMessage }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChatContext() {
  return useContext(ChatContext);
}

export default ChatContext;
