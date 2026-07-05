"use client";

import { useLanguage } from "../context/LanguageContext";

export default function Footer() {
  const { t } = useLanguage();

  const links = [
    { label: t.footer.terms, href: "#" },
    { label: t.footer.privacy, href: "#" },
    { label: t.footer.discord, href: "#" },
  ];

  return (
    <footer className="border-t border-[#222] bg-black py-12">
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
          {links.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="font-display text-[10px] tracking-[0.2em] text-[#555] transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
