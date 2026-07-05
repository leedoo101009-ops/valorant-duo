"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";

type HealthState =
  | { status: "loading" }
  | { status: "ok" }
  | { status: "missing-env" }
  | { status: "error"; message: string };

export default function SupabaseStatus() {
  const { locale } = useLanguage();
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  useEffect(() => {
    fetch("/api/supabase/health")
      .then(async (res) => {
        const data = (await res.json()) as { ok?: boolean; message?: string };
        if (res.status === 503) {
          setHealth({ status: "missing-env" });
          return;
        }
        if (!res.ok || !data.ok) {
          setHealth({
            status: "error",
            message: data.message ?? "Connection failed",
          });
          return;
        }
        setHealth({ status: "ok" });
      })
      .catch(() => {
        setHealth({
          status: "error",
          message: locale === "ko" ? "서버에 연결할 수 없습니다." : "Cannot reach server.",
        });
      });
  }, [locale]);

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const labels = {
    ko: {
      title: "SUPABASE",
      loading: "연결 확인 중…",
      ok: "연결됨",
      missing: ".env.local 설정 필요",
      error: "연결 실패",
    },
    en: {
      title: "SUPABASE",
      loading: "Checking…",
      ok: "Connected",
      missing: ".env.local required",
      error: "Failed",
    },
  } as const;

  const t = labels[locale];

  let detail: string = t.loading;
  let color = "text-[#888] border-[#333]";

  if (health.status === "ok") {
    detail = t.ok;
    color = "text-[#0fbcbf] border-[#0fbcbf]/40";
  } else if (health.status === "missing-env") {
    detail = t.missing;
    color = "text-[#ff4655] border-[#ff4655]/40";
  } else if (health.status === "error") {
    detail = `${t.error}: ${health.message}`;
    color = "text-[#ff4655] border-[#ff4655]/40";
  }

  return (
    <div
      className={`fixed bottom-4 left-4 z-50 border bg-black/90 px-4 py-2 font-display text-[10px] tracking-widest backdrop-blur ${color}`}
      title={detail}
    >
      {t.title} · {detail}
    </div>
  );
}
