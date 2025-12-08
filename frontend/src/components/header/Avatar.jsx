import React from "react";
import getInitials from "../../utils/getInitials";

export default function Avatar({ name = "" }) {
  const initials = getInitials(name);
  return <div className="avatar bg-cdai-sidebar text-cdai-text rounded-none">{initials}</div>;
}
