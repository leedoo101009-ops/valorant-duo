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
      <nav className="mx-auto flex h-16 max-w-[1280px] items-center justify-between px-6 md:h-20 lg:px-12">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[#FF4655] font-headline text-sm font-black text-white">
            D
          </span>
          <span className="font-headline text-xl font-extrabold tracking-tight text-white md:text-2xl">
            Duorant
          </span>
        </Link>

        <div className="hidden items-center gap-5 md:flex">
          <LanguageSwitcher />
          {authReady && user ? (
            <>
              <Link
                href="/profile"
                className="max-w-[120px] truncate font-body text-sm font-medium text-white/90 transition-colors duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:text-white"
              >
                {emailLabel}
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-full border border-white/20 bg-white/5 px-5 py-2.5 font-body text-sm font-semibold text-white transition-[border-color,background] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[#3DE0D0] hover:bg-white/10"
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
                  className="font-body text-sm font-medium text-white"
                  onClick={() => setOpen(false)}
                >
                  {t.nav.profile}: {user.email}
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-full border border-white/20 px-5 py-3 font-body text-sm font-semibold text-white"
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
