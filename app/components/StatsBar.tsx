"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useOnlineCount } from "../hooks/useOnlineCount";

function AnimatedNumber({
  value,
  prefix,
  suffix,
  active,
  durationMs,
}: {
  value: number;
  prefix: string;
  suffix: string;
  active: boolean;
  durationMs: number;
}) {
  const [display, setDisplay] = useState(0);
  const prefersReduced = useRef(false);

  useEffect(() => {
    prefersReduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (!active) return;

    // 접근성: 모션 줄이기면 즉시 최종값
    if (prefersReduced.current) {
      setDisplay(value);
      return;
    }

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1);
      // ease-out cubic — bounce/spring 없음
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, value, durationMs]);

  return (
    <span className="font-mono">
      {prefix}
      {display}
      {suffix}
    </span>
  );
}

export default function StatsBar() {
  const { t } = useLanguage();
  const onlineCount = useOnlineCount();
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  const stats = useMemo(
    () => [
      {
        value: 30,
        suffix: "s",
        prefix: "<",
        label: t.stats.avgMatch,
        durationMs: 1100,
      },
      {
        value: Math.max(onlineCount, 0),
        suffix: "+",
        prefix: "",
        label: t.stats.onlineNow,
        durationMs: 1350,
      },
      {
        value: 94,
        suffix: "%",
        prefix: "",
        label: t.stats.compatRate,
        durationMs: 1500,
      },
    ],
    [onlineCount, t.stats],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // IntersectionObserver — 스크롤 인뷰 시 한 번만 카운트업
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.35 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="w-full bg-black py-20 md:py-28">
      <div ref={ref} className="mx-auto max-w-[1100px] px-6 lg:px-12">
        <h2 className="font-headline text-center text-2xl font-extrabold tracking-tight text-white md:text-[2rem]">
          {t.stats.sectionTitle}
        </h2>

        <div className="mt-12 flex flex-col gap-10 md:mt-16 md:flex-row md:items-start md:justify-between md:gap-6">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              className="flex flex-1 flex-col items-center text-center"
              style={{
                transitionDelay: active ? `${i * 90}ms` : "0ms",
              }}
            >
              <p className="font-mono text-[clamp(2.75rem,6vw,3.75rem)] font-bold leading-none text-white">
                <AnimatedNumber
                  value={stat.value}
                  prefix={stat.prefix}
                  suffix={stat.suffix}
                  active={active}
                  durationMs={stat.durationMs}
                />
              </p>
              <p className="mt-3 font-body text-sm font-medium text-[#C4C2CC] md:text-base">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
