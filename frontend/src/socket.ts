import { io } from "socket.io-client";

declare global {
  interface Window {
    __cdaiSocketUrl?: string;
  }
}

function resolveSocketUrl() {
  if (import.meta?.env?.VITE_SOCKET_URL) {
    return import.meta.env.VITE_SOCKET_URL;
  }
  if (typeof window !== "undefined") {
    if (window.__cdaiSocketUrl) {
      return window.__cdaiSocketUrl;
    }
    const meta = document.querySelector('meta[name="cdai-socket-url"]');
    const metaContent = meta?.getAttribute("content");
    if (metaContent) {
      return metaContent;
    }
    if (import.meta.env.DEV) {
      return "http://localhost:5006";
    }
    return window.location.origin;
  }
  return "http://localhost:5006";
}

const socketUrl = resolveSocketUrl();

export const socket = io(socketUrl, {
  transports: ["websocket"],
  autoConnect: false,
  withCredentials: true,
});

export function connectSocket() {
  if (!socket.connected) {
    socket.connect();
  }
}

export function disconnectSocket() {
  if (socket.connected) {
    socket.disconnect();
  }
}

export default socket;
