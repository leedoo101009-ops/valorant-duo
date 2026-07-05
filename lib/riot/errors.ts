// Riot API HTTP 상태 → 사용자에게 보여줄 에러 키 (i18n용)
export type RiotApiErrorKey =
  | "production_key_required"
  | "api_key_expired"
  | "rate_limit"
  | "not_found"
  | "forbidden"
  | "server_error";

export function mapRiotHttpError(status: number): {
  errorKey: RiotApiErrorKey;
  status: number;
} {
  if (status === 401) {
    return { errorKey: "api_key_expired", status: 401 };
  }

  if (status === 403) {
    return { errorKey: "production_key_required", status: 403 };
  }

  if (status === 404) {
    return { errorKey: "not_found", status: 404 };
  }

  if (status === 429) {
    return { errorKey: "rate_limit", status: 429 };
  }

  return { errorKey: "server_error", status: status >= 400 ? status : 502 };
}
