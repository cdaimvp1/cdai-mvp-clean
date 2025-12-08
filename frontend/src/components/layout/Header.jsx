import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Avatar from "../header/Avatar";
import logo from "../../assets/logos/cd.png";
import LayoutControls from "./LayoutControls";
import PanelPills from "./PanelPills";
import classNames from "../../utils/classNames";

function CommandPaletteDropdown({ options = [], onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const containerRef = useRef(null);

  const normalizedOptions = useMemo(() => {
    const deduped = new Map();
    options.forEach((option) => {
      if (!option?.id) return;
      deduped.set(option.id, {
        id: option.id,
        label: option.label || option.id,
        type: option.type || "panel",
      });
    });
    return Array.from(deduped.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [options]);

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return normalizedOptions;
    return normalizedOptions.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [normalizedOptions, query]);

  const handleSelect = useCallback(
    (option) => {
      if (!option) return;
      onSelect?.(option.id);
      setQuery("");
      setHighlightedIndex(0);
      setOpen(false);
    },
    [onSelect]
  );

  useEffect(() => {
    if (!open) return undefined;
    const handleClick = (event) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  return (
    <div className="command-dropdown" ref={containerRef}>
      <span className="command-dropdown-icon" aria-hidden="true">
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
          <path d="M13 2L6 13H12L11 22L18 11H12L13 2Z" stroke="#f97316" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="command-dropdown-field">
        <input
          type="text"
          className="command-dropdown-input"
          placeholder="Jump to a panel..."
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlightedIndex((prev) => Math.min(prev + 1, Math.max(filteredOptions.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightedIndex((prev) => Math.max(prev - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              handleSelect(filteredOptions[highlightedIndex] || filteredOptions[0]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
        />
        {open && (
          <div className="command-dropdown-menu" role="listbox">
            {filteredOptions.length === 0 ? (
              <div className="command-dropdown-empty">No panels match "{query}".</div>
            ) : (
              filteredOptions.map((option, index) => {
                const isActive = index === highlightedIndex;
                return (
                  <button
                    key={option.id}
                    type="button"
                    className={classNames("command-dropdown-option", isActive && "active")}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      handleSelect(option);
                    }}
                  >
                    <span className="command-dropdown-option-label">{option.label}</span>
                    <span className="command-dropdown-option-type">{option.type === "action" ? "Action" : "Panel"}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Header({
  onLogout,
  governanceMode,
  panelOptions = [],
  onPanelSelect,
  layoutId,
  onLayoutChange,
  headerPanels = [],
  onHeaderPanelSelect,
  onHeaderPanelClose,
}) {
  const strictModeActive = governanceMode === "strict";

  return (
    <header className="app-header">
      <div className="header-left">
        <div className="logo-cluster">
          <img src={logo} alt="cd" className="header-logo" style={{ height: 30 }} />
          {strictModeActive && (
            <span
              className="strict-mode-indicator"
              title="Strict Governance Mode: PHI-like or lineage-sensitive requests may be blocked."
              aria-label="Strict Governance Mode active"
            >
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" role="img" aria-hidden="true">
                <path d="M12 4L3 20H21L12 4Z" stroke="#ef4444" strokeWidth={2} strokeLinejoin="round" />
                <path d="M12 10V14" stroke="#ef4444" strokeWidth={2} strokeLinecap="round" />
                <circle cx={12} cy={17} r={1.2} fill="#ef4444" />
              </svg>
            </span>
          )}
        </div>
        <CommandPaletteDropdown options={panelOptions} onSelect={onPanelSelect} />
        <div className="header-left-controls">
          <div className="header-controls-stack">
            <LayoutControls layoutId={layoutId} onLayoutSelect={onLayoutChange} />
            <PanelPills panels={headerPanels} onSelect={onHeaderPanelSelect} onClose={onHeaderPanelClose} />
          </div>
        </div>
      </div>
      <div className="header-spacer" />
      <div className="header-user">
        <Avatar name="Marc Lane" />
        <div className="user-meta" style={{ fontFamily: "Arimo, sans-serif" }}>
          <div className="user-name" style={{ fontWeight: 600, fontSize: 13, color: "#f0f0f0" }}>
            Marc Lane
          </div>
          <div className="user-role" style={{ fontSize: 12, color: "#b3b3b3" }}>
            Founder &amp; CEO
          </div>
        </div>
      </div>
      <div className="header-actions">
        <button
          className="icon-button"
          aria-label="Theme"
          style={{
            background: "#26262680",
            border: "1px solid #2d2d2d",
            borderRadius: 8,
            width: 36,
            height: 36,
          }}
        >
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
            <path d="M6.99653 9.3287C8.28455 9.3287 9.3287 8.28455 9.3287 6.99653C9.3287 5.7085 8.28455 4.66435 6.99653 4.66435C5.7085 4.66435 4.66435 5.7085 4.66435 6.99653C4.66435 8.28455 5.7085 9.3287 6.99653 9.3287Z" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M2.87444 2.87441L3.69653 3.6965" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10.2966 10.2966L11.1187 11.1186" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M1.16602 6.99653H2.3321" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M11.6609 6.99653H12.827" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3.69653 10.2966L2.87444 11.1186" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M11.1187 2.87441L10.2966 3.6965" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6.99653 1.16602V2.33211" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6.99653 11.6609V12.827" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="icon-button"
          aria-label="Settings"
          style={{
            background: "#26262680",
            border: "1px solid #2d2d2d",
            borderRadius: 8,
            width: 36,
            height: 36,
          }}
        >
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
            <path d="M6.99653 8.74566C7.96255 8.74566 8.74566 7.96255 8.74566 6.99653C8.74566 6.03051 7.96255 5.2474 6.99653 5.2474C6.03051 5.2474 5.2474 6.03051 5.2474 6.99653C5.2474 7.96255 6.03051 8.74566 6.99653 8.74566Z" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5.63865 2.41147C5.67078 2.0735 5.82775 1.75965 6.07891 1.53124C6.33007 1.30282 6.65736 1.17625 6.99685 1.17625C7.33635 1.17625 7.66364 1.30282 7.9148 1.53124C8.16596 1.75965 8.32293 2.0735 8.35506 2.41147C8.37436 2.62979 8.44599 2.84025 8.56386 3.02503C8.68174 3.20981 8.8424 3.36347 9.03224 3.473C9.22208 3.58254 9.43552 3.64473 9.65449 3.6543C9.87345 3.66387 10.0915 3.62055 10.2902 3.528C10.5987 3.38794 10.9482 3.36767 11.2709 3.47114C11.5935 3.57462 11.866 3.79442 12.0355 4.08778C12.205 4.38114 12.2593 4.72707 12.1878 5.05824C12.1163 5.38941 11.9241 5.68212 11.6487 5.87942C11.4693 6.00526 11.3229 6.17246 11.2218 6.36685C11.1208 6.56125 11.068 6.77713 11.068 6.99624C11.068 7.21534 11.1208 7.43122 11.2218 7.62562C11.3229 7.82001 11.4693 7.98721 11.6487 8.11306C11.9241 8.31035 12.1163 8.60307 12.1878 8.93423C12.2593 9.2654 12.205 9.61133 12.0355 9.90469C11.866 10.1981 11.5935 10.4179 11.2709 10.5213C10.9482 10.6248 10.5987 10.6045 10.2902 10.4645C10.0915 10.3719 9.87345 10.3286 9.65449 10.3382C9.43552 10.3477 9.22208 10.4099 9.03224 10.5195C8.8424 10.629 8.68174 10.7827 8.56386 10.9674C8.44599 11.1522 8.37436 11.3627 8.35506 11.581C8.32293 11.919 8.16596 12.2328 7.9148 12.4612C7.66364 12.6897 7.33635 12.8162 6.99685 12.8162C6.65736 12.8162 6.33007 12.6897 6.07891 12.4612C5.82775 12.2328 5.67078 11.919 5.63865 11.581C5.61938 11.3626 5.54776 11.1521 5.42985 10.9672C5.31194 10.7824 5.15121 10.6287 4.96129 10.5191C4.77137 10.4096 4.55785 10.3474 4.3388 10.3379C4.11976 10.3284 3.90165 10.3718 3.70295 10.4645C3.39445 10.6045 3.04488 10.6248 2.72227 10.5213C2.39965 10.4179 2.12708 10.1981 1.9576 9.90469C1.78811 9.61133 1.73384 9.2654 1.80535 8.93423C1.87686 8.60307 2.06903 8.31035 2.34446 8.11306C2.52381 7.98721 2.67022 7.82001 2.77129 7.62562C2.87237 7.43122 2.92514 7.21534 2.92514 6.99624C2.92514 6.77713 2.87237 6.56125 2.77129 6.36685C2.67022 6.17246 2.52381 6.00526 2.34446 5.87942C2.06941 5.68202 1.87758 5.38942 1.80625 5.05848C1.73491 4.72754 1.78917 4.38189 1.95847 4.08872C2.12777 3.79555 2.40003 3.5758 2.72232 3.47217C3.04461 3.36854 3.39392 3.38844 3.70236 3.528C3.90104 3.62055 4.11909 3.66387 4.33806 3.6543C4.55702 3.64473 4.77046 3.58254 4.9603 3.473C5.15015 3.36347 5.3108 3.20981 5.42868 3.02503C5.54656 2.84025 5.61818 2.62979 5.63749 2.41147" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          className="icon-button"
          aria-label="Logout"
          onClick={() => onLogout?.()}
          style={{
            background: "#26262680",
            border: "1px solid #2d2d2d",
            borderRadius: 8,
            width: 36,
            height: 36,
          }}
        >
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: "block" }}>
            <path d="M5.2474 12.2439H2.91522C2.60595 12.2439 2.30936 12.1211 2.09067 11.9024C1.87199 11.6837 1.74913 11.3871 1.74913 11.0778V2.91522C1.74913 2.60595 1.87199 2.30935 2.09067 2.09067C2.30936 1.87199 2.60595 1.74913 2.91522 1.74913H5.2474" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9.3287 3.49828L12.2439 6.99653L9.3287 10.4948M12.2439 6.99653H5.2474" stroke="currentColor" strokeWidth="1.16609" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
