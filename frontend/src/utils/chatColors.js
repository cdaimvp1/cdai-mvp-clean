const baseColors = [
  "#60A5FA",
  "#A78BFA",
  "#34D399",
  "#F472B6",
  "#F87171",
  "#FBBF24",
  "#38BDF8",
  "#4ADE80",
  "#FCA5A5",
  "#C084FC",
];

export function getParticipantColor(key = "") {
  if (!key) return baseColors[0];
  const hash = Array.from(key).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const idx = hash % baseColors.length;
  return baseColors[idx];
}

export const systemColor = "#1f2937";
export const assistantColor = "#2563eb";
