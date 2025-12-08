import React from "react";
import CanvasPanelUnit from "./CanvasPanelUnit";

import { PANEL_LAYOUTS } from "../../context/PanelLayoutContext";

export default function CanvasPanelBody({ layoutMode, layoutVersion = 0, panels, onClose, onSwap, onReorder }) {
  // Proportions per layout to match icon intent
  const LAYOUT_PROPORTIONS = {
    "1panel": { columns: ["1fr"], rows: ["1fr"] },
    "2v": { columns: ["1fr", "1fr"], rows: ["1fr"] }, // side-by-side 50/50
    "2h": { columns: ["1fr"], rows: ["1fr", "1fr"] }, // top/bottom 50/50
    "3grid": { columns: ["1fr", "1fr"], rows: ["1fr", "1fr"] }, // 50% top, two 25% bottom
    "4grid": { columns: ["1fr", "1fr"], rows: ["1fr", "1fr"] }, // 25% quadrants
    "tallLeft2": { columns: ["2fr", "3fr"], rows: ["1fr", "1fr"] }, // 40/60 with two stacks
    "tallLeft3": { columns: ["2fr", "3fr"], rows: ["1fr", "1fr", "1fr"] }, // 40/60 with three stacks
  };

  const layout = PANEL_LAYOUTS.find((l) => l.id === layoutMode);
  const grid = layout?.grid || [["A"]];

  const templateAreas = grid.map((row) => `"${row.join(" ")}"`).join(" ");
  const maxCols = grid.reduce((max, row) => Math.max(max, row.length), 1);
  const proportions = LAYOUT_PROPORTIONS[layoutMode];
  const templateColumns =
    proportions?.columns?.join(" ") || `repeat(${maxCols}, minmax(0, 1fr))`;
  const templateRows =
    proportions?.rows?.join(" ") || `repeat(${grid.length}, minmax(0, 1fr))`;

  const uniqueAreas = [];
  grid.forEach((row) =>
    row.forEach((cell) => {
      if (!uniqueAreas.includes(cell)) uniqueAreas.push(cell);
    })
  );

  return (
    <div className="canvas-body">
      <div
        className="canvas-grid"
        key={`${layoutMode}-${layoutVersion}`}
        style={{
          height: "100%",
          minHeight: 0,
          overflow: "auto",
          gridTemplateAreas: templateAreas,
          gridTemplateColumns: templateColumns,
          gridTemplateRows: templateRows,
        }}
      >
        {panels.map((panel, idx) => {
          const area = uniqueAreas[idx] || uniqueAreas[uniqueAreas.length - 1] || "auto";
          return (
            <CanvasPanelUnit
              key={panel.id}
              panel={panel}
              gridArea={area}
              onClose={() => onClose(panel.id)}
              onSwap={onSwap}
              onReorder={onReorder}
            />
          );
        })}
      </div>
    </div>
  );
}
