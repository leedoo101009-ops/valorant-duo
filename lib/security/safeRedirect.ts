// auth callback 등에서 open redirect 방지
export function safeRedirectPath(next: string | null): string {
  if (!next) {
    return "/";
  }

  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return "/";
  }

  const blocked =
    !next.startsWith("/") ||
    next.startsWith("//") ||
    decoded.startsWith("//") ||
    next.includes("\\") ||
    decoded.includes("\\") ||
    next.includes("@") ||
    decoded.includes("@") ||
    next.includes("\0") ||
    decoded.includes("\0") ||
    /[\u0000-\u001F\u007F]/.test(decoded);

  if (blocked) {
    return "/";
  }

  return next;
}
