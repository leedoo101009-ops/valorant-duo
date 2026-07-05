"use client";

import { useEffect, useState } from "react";
import { ONLINE_COUNT_POLL_MS } from "@/lib/presence/constants";

export function useOnlineCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    async function fetchCount() {
      try {
        const response = await fetch("/api/presence/online");
        const data = (await response.json()) as { ok?: boolean; count?: number };
        if (response.ok && data.ok && typeof data.count === "number") {
          setCount(data.count);
        }
      } catch {
        // 실패 시 이전 count 유지
      }
    }

    void fetchCount();
    const intervalId = window.setInterval(fetchCount, ONLINE_COUNT_POLL_MS);
    return () => window.clearInterval(intervalId);
  }, []);

  return count;
}
