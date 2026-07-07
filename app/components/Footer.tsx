"use client";

import Link from "next/link";
import { useLanguage } from "../context/LanguageContext";

export default function Footer() {
  const { t } = useLanguage();

  // Next.js Link를 쓰면 /terms, /privacy로 확실히 페이지 이동합니다.
  // 예전 href="#" 방식은 클릭 시 맨 위로만 스크롤되고 페이지가 안 바뀌었어요.
  const legalLinks = [
    { label: t.footer.terms, href: "/terms" as const },
    { label: t.footer.privacy, href: "/privacy" as const },
  ];

  return (
    <footer className="relative z-10 border-t border-[#222] bg-black py-12">
      <div className="mx-auto flex max-w-[1400px] flex-col items-start justify-between gap-8 px-6 sm:flex-row sm:items-center lg:px-12">
        <div className="flex items-center gap-4">
          <div className="flex h-8 w-8 items-center justify-center border border-[#333] bg-[#111]">
            <span className="font-display text-sm font-bold">D</span>
          </div>
          <div>
            <p className="font-display text-sm font-bold tracking-[0.2em]">DUO</p>
            <p className="text-[10px] text-[#555]">{t.footer.copyright}</p>
          </div>
        </div>

        <div className="flex gap-8">
          {legalLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-display text-[10px] tracking-[0.2em] text-[#555] transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          ))}
          <span className="font-display text-[10px] tracking-[0.2em] text-[#555]">
            {t.footer.discord}
          </span>
        </div>
      </div>
    </footer>
  );
}
