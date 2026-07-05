// Phase 4-2: 매칭 큐
export const QUEUE_STALE_MINUTES = 5;
export const QUEUE_STATUS_POLL_MS = 5_000;

// 매칭 후 보이스 미선택 시 자동 취소 (초)
export const MATCH_RESPONSE_TIMEOUT_SECONDS = 90;

// 파티 구성(완료/취소) 단계 타임아웃 (초) — 4분
export const MATCH_SETUP_TIMEOUT_SECONDS = 240;

// 매칭 중 상대 오프라인 판정 (초) — heartbeat 간격(30s) + 여유
export const MATCH_OFFLINE_THRESHOLD_SECONDS = 90;
