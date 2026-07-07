"use client";

import Link from "next/link";
import { SITE_CONTACT_EMAIL } from "@/site.contact";
import { useLanguage } from "../context/LanguageContext";

type LegalDocumentProps = {
  type: "terms" | "privacy";
};

export default function LegalDocument({ type }: LegalDocumentProps) {
  const { t } = useLanguage();
  const doc = type === "terms" ? t.legal.terms : t.legal.privacy;

  return (
    <main className="min-h-screen bg-black pt-28 pb-20">
      <div className="mx-auto max-w-3xl px-6 lg:px-12">
        <Link
          href="/"
          className="font-display text-[10px] tracking-widest text-[#555] transition-colors hover:text-white"
        >
          ← {t.legal.backHome}
        </Link>

        <p className="mt-6 font-display text-xs tracking-[0.25em] text-[#ff4655]">
          {doc.label}
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold text-white">{doc.title}</h1>
        <p className="mt-3 text-sm text-[#555]">{t.legal.lastUpdated}</p>

        <div className="mt-10 space-y-8">
          {doc.sections.map((section) => (
            <section key={section.title} className="space-y-3">
              <h2 className="font-display text-sm font-bold tracking-widest text-[#0fbcbf]">
                {section.title}
              </h2>
              <div className="space-y-3 text-sm leading-relaxed text-[#bbb]">
                {section.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 border border-[#333] bg-[#111] p-6">
          <p className="font-display text-[10px] tracking-widest text-[#555]">
            {t.legal.contactBoxLabel}
          </p>
          <a
            href={`mailto:${SITE_CONTACT_EMAIL}`}
            className="mt-2 inline-block font-mono text-lg text-[#0fbcbf] transition-colors hover:text-white"
          >
            {SITE_CONTACT_EMAIL}
          </a>
        </div>
      </div>
    </main>
  );
}
