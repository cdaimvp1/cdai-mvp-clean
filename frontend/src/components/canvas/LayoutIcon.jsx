import React from "react";

export default function LayoutIcon({ type, active }) {
  const baseClass = "w-6 h-6 transition-all";

  // Active = electric blue, Inactive = neutral grey
  const color = active ? "#007AFF" : "#A1A1A1";

  const commonSvgProps = {
    className: baseClass,
    viewBox: "0 0 24 24",
    width: 24,
    height: 24,
    style: { color }, // drives currentColor in strokes/fills
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
    focusable: false,
  };

  switch (type) {
    case "1panel":
      return (
        <svg {...commonSvgProps} role="img" aria-label="Single panel layout">
          <rect x={4} y={4} width={16} height={16} rx={2} stroke="currentColor" strokeWidth={2} />
        </svg>
      );

    case "2h":
      return (
        <svg {...commonSvgProps} role="img" aria-label="Two rows layout">
          <rect x={4} y={4} width={16} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={4} y={13} width={16} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
        </svg>
      );

    case "2v":
      return (
        <svg {...commonSvgProps} role="img" aria-label="Two columns layout">
          <rect x={4} y={4} width={7} height={16} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={13} y={4} width={7} height={16} rx={2} stroke="currentColor" strokeWidth={2} />
        </svg>
      );

    case "3grid":
      return (
        <svg {...commonSvgProps} role="img" aria-label="Three-panel grid layout">
          <rect x={4} y={4} width={16} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={4} y={13} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={13} y={13} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
        </svg>
      );

    case "4grid":
      return (
        <svg {...commonSvgProps} role="img" aria-label="Four-panel grid layout">
          <rect x={4} y={4} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={13} y={4} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={4} y={13} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={13} y={13} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
        </svg>
      );

    case "tallLeft2":
      return (
        <svg {...commonSvgProps} role="img" aria-label="Tall left with two stack layout">
          <rect x={4} y={4} width={7} height={16} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={13} y={4} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={13} y={13} width={7} height={7} rx={2} stroke="currentColor" strokeWidth={2} />
        </svg>
      );

    case "tallLeft3":
      return (
        <svg {...commonSvgProps} role="img" aria-label="Tall left with three stack layout">
          <rect x={4} y={4} width={7} height={16} rx={2} stroke="currentColor" strokeWidth={2} />
          <rect x={13} y={4} width={7} height={5} rx={1.5} stroke="currentColor" strokeWidth={2} />
          <rect x={13} y={10.5} width={7} height={4.5} rx={1.5} stroke="currentColor" strokeWidth={2} />
          <rect x={13} y={16.5} width={7} height={3.5} rx={1.5} stroke="currentColor" strokeWidth={2} />
        </svg>
      );

    default:
      return null;
  }
}
