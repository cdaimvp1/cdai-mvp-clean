import React from "react";
import classNames from "../../utils/classNames";
import { PANEL_LAYOUTS, usePanelLayoutContext } from "../../context/PanelLayoutContext";
import LayoutIcon from "../canvas/LayoutIcon";

export default function LayoutControls({ className = "", layoutId, onLayoutSelect }) {
  const { layout, ensurePanelsForLayout, setLayout } = usePanelLayoutContext();
  const activeLayout = layoutId || layout;

  const handleSelect = (nextLayoutId) => {
    if (onLayoutSelect) {
      onLayoutSelect(nextLayoutId);
      return;
    }
    ensurePanelsForLayout(nextLayoutId);
    setLayout(nextLayoutId);
  };

  return (
    <div className={classNames("header-layout-controls", className)}>
      {PANEL_LAYOUTS.map((layoutDef) => {
        const isActive = activeLayout === layoutDef.id;
        return (
          <button
            key={layoutDef.id}
            type="button"
            className="layout-icon-button"
            aria-label={`Switch to ${layoutDef.id} layout`}
            aria-pressed={isActive}
            onClick={() => handleSelect(layoutDef.id)}
          >
            <LayoutIcon type={layoutDef.id} active={isActive} />
          </button>
        );
      })}
    </div>
  );
}
