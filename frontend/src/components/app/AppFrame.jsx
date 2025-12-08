import React from "react";

export default function AppFrame({ header, footer, children }) {
  return (
    <div className="app-shell bg-cdai-body text-cdai-text">
      {header}
      <main className="app-main">{children}</main>
      {footer}
    </div>
  );
}
