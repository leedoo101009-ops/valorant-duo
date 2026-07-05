const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseUuid(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

// cross-site POST(CSRF) 완화 — 브라우저 fetch/beacon은 Sec-Fetch-Site / Origin 으로 판별
export function isTrustedSiteRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "same-site") {
    return true;
  }

  const host = request.headers.get("host");
  if (!host) {
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  return false;
}

export function forbiddenUnlessTrustedOrigin(request: Request): Response | null {
  if (isTrustedSiteRequest(request)) {
    return null;
  }

  return Response.json({ ok: false, errorKey: "forbidden" }, { status: 403 });
}
