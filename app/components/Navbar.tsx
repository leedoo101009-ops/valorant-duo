"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "@/lib/auth/useAuth";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Navbar() {
  const { t } = useLanguage();
  const router = useRouter();
  const { user, authReady, signOut } = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function handleLogout() {
    await signOut();
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  const emailLabel = user?.email?.split("@")[0] ?? "";

  return (
    <header
      className={`fixed top-0 right-0 left-0 z-50 transition-[background-color,border-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        scrolled
          ? "border-b border-white/10 bg-[#05080b]/85 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      {/* 로고는 화면 왼쪽에 더 붙이고, 오른쪽 메뉴만 기존 여백 유지 */}
      <nav className="flex h-20 w-full items-center justify-between pl-3 pr-6 md:h-24 md:pl-4 lg:pr-12">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-md bg-[#FF4655] font-headline text-lg font-black text-white md:h-12 md:w-12 md:text-xl">
            D
          </span>
          <span className="font-headline text-2xl font-extrabold tracking-tight text-white md:text-3xl">
            Duorant
          </span>
        </Link>

        <div className="hidden items-center gap-3 md:flex lg:gap-4">
          <LanguageSwitcher />
          {authReady && user ? (
            <>
              {/* 프로필 진입 — 글래스 칩 (랜딩 secondary 톤) */}
              <Link
                href="/profile"
                className="group inline-flex max-w-[180px] items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.06] py-1.5 pr-4 pl-1.5 font-body text-sm font-semibold text-[#F5F5F7] transition-[border-color,background,color] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[#3DE0D0]/55 hover:bg-[rgba(61,224,208,0.08)]"
                title={t.nav.profile}
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#3DE0D0]/15 font-headline text-[11px] font-bold text-[#3DE0D0]">
                  {(emailLabel[0] ?? "?").toUpperCase()}
                </span>
                <span className="truncate">{emailLabel}</span>
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-white/15 bg-white/[0.06] px-5 py-2.5 font-body text-sm font-semibold text-[#F5F5F7] transition-[border-color,background] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[#3DE0D0]/55 hover:bg-[rgba(61,224,208,0.08)]"
              >
                {t.nav.logout}
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-full bg-[#FF4655] px-5 py-2.5 font-body text-sm font-semibold text-white shadow-[0_8px_24px_rgba(255,70,85,0.35)] transition-[filter,transform] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:scale-[1.02] hover:brightness-110"
            >
              {t.nav.login}
            </Link>
          )}
        </div>

        <button
          type="button"
          className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-lg border border-white/20 md:hidden"
          onClick={() => setOpen(!open)}
          aria-label={t.nav.menu}
        >
          <span
            className={`block h-px w-5 bg-white transition-transform duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? "translate-y-[7px] rotate-45" : ""}`}
          />
          <span
            className={`block h-px w-5 bg-white transition-opacity duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? "opacity-0" : ""}`}
          />
          <span
            className={`block h-px w-5 bg-white transition-transform duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? "-translate-y-[7px] -rotate-45" : ""}`}
          />
        </button>
      </nav>

      {open && (
        <div className="border-t border-white/10 bg-[#05080b]/95 px-6 py-6 backdrop-blur-md md:hidden">
          <div className="flex flex-col gap-3">
            <LanguageSwitcher />
            {authReady && user ? (
              <>
                <Link
                  href="/profile"
                  className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.06] py-2 pr-4 pl-2 font-body text-sm font-semibold text-[#F5F5F7]"
                  onClick={() => setOpen(false)}
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#3DE0D0]/15 font-headline text-[11px] font-bold text-[#3DE0D0]">
                    {(emailLabel[0] ?? "?").toUpperCase()}
                  </span>
                  <span className="truncate">{emailLabel}</span>
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-white/15 bg-white/[0.06] px-5 py-3 font-body text-sm font-semibold text-[#F5F5F7]"
                >
                  {t.nav.logout}
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-full bg-[#FF4655] px-5 py-3 text-center font-body text-sm font-semibold text-white"
                onClick={() => setOpen(false)}
              >
                {t.nav.login}
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
