import React from "react";

export default function IconLayout4({ className = "", size = 20, color = "currentColor" }) {
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
        <path d="M8 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H8C9.10457 21 10 20.1046 10 19V5C10 3.89543 9.10457 3 8 3Z" />
        <path d="M19 3H14C12.8954 3 12 3.89543 12 5V9C12 10.1046 12.8954 11 14 11H19C20.1046 11 21 10.1046 21 9V5C21 3.89543 20.1046 3 19 3Z" />
        <path d="M19 13H14C12.8954 13 12 13.8954 12 15V19C12 20.1046 12.8954 21 14 21H19C20.1046 21 21 20.1046 21 19V15C21 13.8954 20.1046 13 19 13Z" />
      </g>
    </svg>
  );
}
