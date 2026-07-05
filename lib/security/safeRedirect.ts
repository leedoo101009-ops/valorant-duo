// auth callback 등에서 open redirect 방지
export function safeRedirectPath(next: string | null): string {
  if (!next) {
    return "/";
  }

  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return "/";
  }

  return next;
}
