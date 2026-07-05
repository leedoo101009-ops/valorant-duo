"use client";

import { useLanguage } from "../context/LanguageContext";
import ScrollReveal from "./ScrollReveal";

const stepIcons = [
  (
    <svg key="connect" width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect x="6" y="10" width="20" height="12" stroke="currentColor" strokeWidth="1" />
      <path d="M12 16h8" stroke="currentColor" strokeWidth="1" />
      <circle cx="10" cy="16" r="2" stroke="currentColor" strokeWidth="1" />
      <circle cx="22" cy="16" r="2" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  (
    <svg key="analyze" width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect x="6" y="20" width="4" height="6" fill="currentColor" />
      <rect x="14" y="14" width="4" height="12" fill="currentColor" />
      <rect x="22" y="8" width="4" height="18" fill="currentColor" />
      <line x1="4" y1="26" x2="28" y2="26" stroke="#333" strokeWidth="1" />
    </svg>
  ),
  (
    <svg key="match" width="32" height="32" viewBox="0 0 32 32" fill="none">
      <path d="M16 4L28 16L16 28L4 16Z" stroke="currentColor" strokeWidth="1" />
      <path d="M16 10L22 16L16 22L10 16Z" stroke="currentColor" strokeWidth="1" />
    </svg>
  ),
  (
    <svg key="play" width="32" height="32" viewBox="0 0 32 32" fill="none">
      <rect x="4" y="8" width="24" height="16" stroke="currentColor" strokeWidth="1" />
      <path d="M12 13l8 3-8 3V13z" fill="currentColor" />
    </svg>
  ),
];

export default function FlowSection() {
  const { t } = useLanguage();

  const steps = [
    { num: "01", label: t.flow.steps.connect, icon: stepIcons[0] },
    { num: "02", label: t.flow.steps.analyze, icon: stepIcons[1] },
    { num: "03", label: t.flow.steps.match, icon: stepIcons[2] },
    { num: "04", label: t.flow.steps.play, icon: stepIcons[3] },
  ];

  return (
    <section id="system" className="border-t border-[#222] bg-[#0a0a0a] py-32 lg:py-40">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        <ScrollReveal>
          <p className="font-display text-xs tracking-[0.3em] text-[#888]">{t.flow.label}</p>
          <h2 className="mt-4 font-display text-[clamp(2rem,5vw,4rem)] font-bold uppercase leading-none">
            {t.flow.titleLine1}
            <br />
            {t.flow.titleLine2}
          </h2>
        </ScrollReveal>

        <div className="mt-20 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, i) => (
            <ScrollReveal key={step.num} delay={i * 100}>
              <div className="group relative">
                {i < steps.length - 1 && (
                  <div className="absolute top-1/2 -right-3 z-10 hidden h-px w-6 bg-[#333] lg:block" />
                )}
                <div className="panel panel-hover p-8 lg:p-10">
                  <span className="font-display text-5xl font-bold text-[#222] transition-colors group-hover:text-[#ff4655]/30">
                    {step.num}
                  </span>
                  <div className="mt-8 text-[#888] transition-colors group-hover:text-[#ff4655]">
                    {step.icon}
                  </div>
                  <p className="mt-8 font-display text-lg font-bold tracking-[0.15em]">{step.label}</p>
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
