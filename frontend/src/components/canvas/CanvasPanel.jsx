import React from "react";
import CanvasPanelBody from "./CanvasPanelBody";
import { usePanelLayoutContext, PANEL_LAYOUTS } from "../../context/PanelLayoutContext";

function CanvasPanelInner({ panelsOverride, layoutOverride, onPanelClose }) {
  const {
    layout,
    layoutVersion,
    setLayout,
    visiblePanels,
    swapPanels,
    reorderVisible,
    hidePanel,
    setPanels,
  } = usePanelLayoutContext();

  React.useEffect(() => {
    if (layoutOverride) setLayout(layoutOverride);
  }, [layoutOverride, setLayout]);

  React.useEffect(() => {
    if (panelsOverride) setPanels(panelsOverride);
  }, [panelsOverride, setPanels]);

  const currentLayout = PANEL_LAYOUTS.find((l) => l.id === layout);
  const displayPanels = currentLayout ? visiblePanels.slice(0, currentLayout.slots) : visiblePanels;

  const removePanel = (id) => {
    if (onPanelClose) {
      onPanelClose(id);
      return;
    }
    hidePanel(id);
  };

  // Enforce active panel cap of 8
  const cappedPanels = displayPanels.slice(0, 8);

  return (
    <div className="canvas-panel bg-cdai-body border border-cdai-border rounded-none">
      <CanvasPanelBody
        layoutMode={layout}
        layoutVersion={layoutVersion}
        panels={cappedPanels}
        onClose={removePanel}
        onSwap={swapPanels}
        onReorder={reorderVisible}
      />
    </div>
  );
}

export default function CanvasPanel({ panelsOverride, layoutOverride, onPanelClose }) {
  return (
    <CanvasPanelInner panelsOverride={panelsOverride} layoutOverride={layoutOverride} onPanelClose={onPanelClose} />
  );
}
