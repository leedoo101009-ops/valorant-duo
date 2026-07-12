// POST /api/matching/queue — STEP 6 매칭 큐 API
// 큐 입장 → findBestMatch 궁합 매칭 → 결과 반환

import { handleQueuePost } from "@/lib/matching/handleQueuePost";

export async function POST(request: Request) {
  return handleQueuePost(request);
}
