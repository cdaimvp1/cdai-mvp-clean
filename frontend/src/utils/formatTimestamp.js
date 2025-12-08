export default function formatTimestamp(dateLike) {
  const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
