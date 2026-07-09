import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { forbiddenUnlessTrustedOrigin, parseUuid } from "@/lib/security/apiGuards";
import {
  NEGATIVE_REVIEW_TAGS,
  POSITIVE_REVIEW_TAGS,
  type NegativeReviewTag,
  type PositiveReviewTag,
} from "@/lib/reputation/constants";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rateLimit";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function sanitizeTags(value: unknown, allowed: readonly string[]): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const tags = [...new Set(value.filter((tag): tag is string => typeof tag === "string"))];
  if (tags.some((tag) => !allowed.includes(tag))) {
    return null;
  }

  return tags;
}

// POST /api/match/review/submit
export async function POST(request: Request) {
  const originBlock = forbiddenUnlessTrustedOrigin(request);
  if (originBlock) {
    return originBlock;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ ok: false, errorKey: "login_required" }, { status: 401 });
  }

  const { allowed, retryAfterSec } = checkRateLimit(
    `match-review-submit:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );

  if (!allowed) {
    return Response.json(
      { ok: false, errorKey: "rate_limit", retryAfterSec },
      { status: 429 },
    );
  }

  let body: {
    matchId?: string;
    positiveTags?: unknown;
    negativeTags?: unknown;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, errorKey: "invalid_request" }, { status: 400 });
  }

  const matchId = parseUuid(body.matchId);
  const positiveTags = sanitizeTags(body.positiveTags, POSITIVE_REVIEW_TAGS);
  const negativeTags = sanitizeTags(body.negativeTags, NEGATIVE_REVIEW_TAGS);

  if (!matchId || positiveTags === null || negativeTags === null) {
    return Response.json({ ok: false, errorKey: "invalid_request" }, { status: 400 });
  }

  if (positiveTags.length === 0 && negativeTags.length === 0) {
    return Response.json({ ok: false, errorKey: "tags_required" }, { status: 400 });
  }

  if (!hasAdminClient()) {
    return Response.json({ ok: false, errorKey: "server_error" }, { status: 503 });
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("submit_duo_match_review", {
    p_reviewer_id: user.id,
    p_match_id: matchId,
    p_positive_tags: positiveTags as PositiveReviewTag[],
    p_negative_tags: negativeTags as NegativeReviewTag[],
  });

  if (error) {
    const message = error.message ?? "";

    if (message.includes("match_not_found")) {
      return Response.json({ ok: false, errorKey: "match_not_found" }, { status: 404 });
    }
    if (message.includes("review_already_submitted")) {
      return Response.json({ ok: false, errorKey: "review_already_submitted" }, { status: 409 });
    }
    if (message.includes("match_not_reviewable")) {
      return Response.json({ ok: false, errorKey: "match_not_reviewable" }, { status: 400 });
    }
    if (message.includes("not_participant")) {
      return Response.json({ ok: false, errorKey: "not_participant" }, { status: 403 });
    }
    if (message.includes("review_window_expired")) {
      return Response.json({ ok: false, errorKey: "review_window_expired" }, { status: 400 });
    }
    if (message.includes("tags_required") || message.includes("invalid_tags")) {
      return Response.json({ ok: false, errorKey: "invalid_request" }, { status: 400 });
    }

    return Response.json({ ok: false, errorKey: "review_submit_failed" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
