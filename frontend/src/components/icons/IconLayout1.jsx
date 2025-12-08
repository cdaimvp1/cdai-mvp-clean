import React from "react";

export default function IconLayout1({ className = "", size = 20, color = "currentColor" }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g opacity="0.6" fill={color}>
        <path d="M9 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H9C10.1046 21 11 20.1046 11 19V5C11 3.89543 10.1046 3 9 3Z" />
        <path d="M19 3H15C13.8954 3 13 3.89543 13 5V19C13 20.1046 13.8954 21 15 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" />
      </g>
    </svg>
  );
}
