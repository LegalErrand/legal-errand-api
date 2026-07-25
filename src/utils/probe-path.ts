/** Paths commonly hit by automated security scanners — not real app traffic. */
export function isProbePath(url: string): boolean {
  const path = url.split("?")[0].toLowerCase();

  // Real API misses should still surface in logs.
  if (path.startsWith("/api/")) return false;

  return (
    path.includes(".env") ||
    /\.ya?ml$/.test(path) ||
    /\/settings\.(json|ini)$/.test(path) ||
    /\/environments\.ini$/.test(path) ||
    /\/(config|constants?|env|app|server)\.js$/.test(path) ||
    /\.cgi$/.test(path) ||
    path.includes("/.git") ||
    path.includes("phpinfo") ||
    path.includes("/wp-") ||
    path.includes("/actuator")
  );
}
