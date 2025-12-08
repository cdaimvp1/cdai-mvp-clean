import React from "react";
import LandingPage from "./components/layout/LandingPage";
import LoginPage from "./components/layout/LoginPage";
import { useAuth } from "./context/AuthContext";

function LoadingScreen() {
  return (
    <div className="app-shell" style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center", color: "#f5f5f5", fontFamily: "Arimo, sans-serif" }}>
        <p style={{ marginBottom: 8, fontSize: 14, letterSpacing: 0.5 }}>Loading cd/ai…</p>
        <div style={{ width: 160, height: 3, background: "#1f1f1f", borderRadius: 2, overflow: "hidden", margin: "0 auto" }}>
          <div style={{ width: "60%", height: "100%", background: "#007aff" }} />
        </div>
      </div>
    </div>
  );
}

function App() {
  const { status, logout } = useAuth();

  if (status === "loading") {
    return <LoadingScreen />;
  }

  if (status !== "authenticated") {
    return <LoginPage />;
  }

  return <LandingPage onLogout={logout} />;
}

export default App;
