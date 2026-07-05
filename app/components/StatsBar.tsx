"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useOnlineCount } from "../hooks/useOnlineCount";
import ScrollReveal from "./ScrollReveal";

function AnimatedNumber({
  value,
  prefix,
  suffix,
  active,
}: {
  value: number;
  prefix: string;
  suffix: string;
  active: boolean;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!active) return;

    const duration = 1200;
    const start = performance.now();

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  }, [active, value]);

  return (
    <span>
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
      { value: 30, suffix: "s", prefix: "<", label: t.stats.avgMatch },
      { value: onlineCount, suffix: "", prefix: "", label: t.stats.onlineNow },
      { value: 94, suffix: "%", prefix: "", label: t.stats.compatRate },
      { value: 24, suffix: "/7", prefix: "", label: t.stats.liveEngine },
    ],
    [onlineCount, t.stats],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="border-t border-[#222] bg-[#0a0a0a] py-24 lg:py-32">
      <div ref={ref} className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <ScrollReveal>
          <div className="grid grid-cols-2 gap-px bg-[#222] lg:grid-cols-4">
            {stats.map((stat, i) => (
              <div
                key={stat.label}
                className="group bg-[#111] p-8 transition-colors hover:bg-[#161616] lg:p-12"
              >
                <p className="font-display text-[clamp(2.5rem,6vw,4rem)] font-bold leading-none text-[#ff4655]">
                  <AnimatedNumber
                    value={stat.value}
                    prefix={stat.prefix}
                    suffix={stat.suffix}
                    active={active}
                  />
                </p>
                <p className="mt-4 font-display text-xs tracking-[0.2em] text-[#555] transition-colors group-hover:text-[#888]">
                  {stat.label}
                </p>
                <div
                  className="mt-6 h-px w-8 bg-[#333] transition-all group-hover:w-16 group-hover:bg-[#ff4655]"
                  style={{ transitionDelay: `${i * 50}ms` }}
                />
              </div>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
