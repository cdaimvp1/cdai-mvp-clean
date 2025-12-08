import React, { useState } from "react";
import logo from "../../assets/logos/cdai.png";
import { IconSecure, IconFastSSO, IconEnterpriseSSO, IconEmailLogin, IconPasswordLogin, IconEye } from "../icons";
import { useAuth } from "../../context/AuthContext";

export default function LoginPage({ onLoginSuccess = () => {} }) {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ username, password, remember });
      onLoginSuccess();
    } catch (err) {
      if (err?.status === 401) {
        setError("Invalid username or password.");
      } else {
        setError("Unable to sign in. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSSO = () => {
    setError("SSO federation is not enabled on this environment. Use your cd/ai credentials.");
  };

  return (
    <div className="login-page figma-login-bg text-cdai-text">
      <div className="login-wrapper figma-login-wrapper">
        <div className="login-logo-stack">
          <img src={logo} alt="cdai" className="figma-login-logo" />
          <p className="figma-login-tagline figma-login-tagline-large">Where governed intelligence meets decision velocity.</p>
        </div>

        <div className="login-card figma-login-card">
          <div className="figma-login-header">
            <h2>Sign In</h2>
            <p>Authenticate to access cd/ai runtime governance</p>
          </div>

          <div className="figma-login-sso">
            <button type="button" className="figma-login-sso-button" onClick={handleSSO}>
              <IconSecure size={14} style={{ color: "rgba(255, 255, 255, 0.4)" }} />
              Continue with Single Sign-On (SSO)
            </button>
            <div className="figma-sso-badges">
              <div className="figma-sso-badge" style={{ color: "#05df72" }}>
                <IconSecure size={12} style={{ color: "#05df72" }} />
                <span>Secure</span>
              </div>
              <div className="figma-sso-badge" style={{ color: "#51a2ff" }}>
                <IconFastSSO size={12} style={{ color: "#51a2ff" }} />
                <span>Fast</span>
              </div>
              <div className="figma-sso-badge" style={{ color: "#c27aff" }}>
                <IconEnterpriseSSO size={12} style={{ color: "#c27aff" }} />
                <span>Enterprise</span>
              </div>
            </div>
          </div>

          <div className="figma-login-divider">
            <span>or continue with credentials</span>
          </div>

          <form onSubmit={handleSubmit} className="figma-login-form">
            <div className="figma-field">
              <label htmlFor="username">Username or Email</label>
              <div className="figma-input-wrap">
                <IconEmailLogin size={14} className="figma-input-icon" />
                <input
                  id="username"
                  type="text"
                  placeholder="admin@company.com"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="figma-field">
              <label htmlFor="password">Password</label>
              <div className="figma-input-wrap">
                <IconPasswordLogin size={14} className="figma-input-icon" />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                />
                <button type="button" className="figma-eye" onClick={() => setShowPassword((v) => !v)} aria-label="Toggle password visibility">
                  <IconEye size={14} />
                </button>
              </div>
            </div>

            <div className="figma-login-row">
              <label className="figma-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>
              <button type="button" className="figma-forgot" disabled>
                Forgot password?
              </button>
            </div>

            {error && (
              <div
                style={{
                  marginTop: 8,
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(239, 68, 68, 0.18)",
                  border: "1px solid rgba(239, 68, 68, 0.35)",
                  fontSize: 12,
                  color: "#fde68a",
                }}
              >
                {error}
              </div>
            )}

            <button type="submit" className="figma-submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign In with Credentials"}
            </button>
          </form>
        </div>

        <div className="figma-login-footer">
          <p>
            Need help?{" "}
            <button type="button" className="figma-footer-link">
              Contact IT Support
            </button>
          </p>
          <p className="figma-footer-legal">
            &copy; 2025 Change Directories, LLC | Envoke<span className="sup">OS&trade;</span> powered by cd\ai<span className="sup">&trade;</span> | Patent Pending
          </p>
        </div>
      </div>
    </div>
  );
}
