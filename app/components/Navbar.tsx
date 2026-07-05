"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useLanguage } from "../context/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import { ensureProfile } from "@/lib/supabase/profile";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Navbar() {
  const { t } = useLanguage();
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const links = [
    { label: t.nav.features, href: "#features" },
    { label: t.nav.system, href: "#system" },
    { label: t.nav.dashboard, href: "#dashboard" },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setOpen(false);
    router.push("/");
    router.refresh();
  }

  const emailLabel = user?.email?.split("@")[0] ?? "";

  return (
    <header
      className={`fixed top-0 right-0 left-0 z-50 transition-colors duration-300 ${
        scrolled ? "border-b border-[#222] bg-black" : "bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-20 max-w-[1400px] items-center justify-between px-6 lg:px-12">
        <Link href="/" className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center border border-[#333] bg-[#111]">
            <span className="font-display text-lg font-bold tracking-widest">D</span>
          </div>
          <span className="font-display text-2xl font-bold tracking-[0.2em]">DUO</span>
        </Link>

        <div className="hidden items-center gap-10 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="font-display text-xs font-semibold tracking-[0.2em] text-[#888] transition-colors hover:text-white"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-4 md:flex">
          <LanguageSwitcher />
          {authReady && user ? (
            <>
              <Link
                href="/profile"
                className="max-w-[120px] truncate font-display text-xs tracking-widest text-[#888] transition-colors hover:text-white"
              >
                {emailLabel}
              </Link>
              <button type="button" onClick={handleLogout} className="btn-outline !px-6 !py-3 !text-xs">
                {t.nav.logout}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-outline !px-6 !py-3 !text-xs">
                {t.nav.login}
              </Link>
              <Link href="/login?mode=signup" className="btn-accent !px-6 !py-3 !text-xs">
                {t.nav.start}
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="flex h-10 w-10 flex-col items-center justify-center gap-1.5 border border-[#333] md:hidden"
          onClick={() => setOpen(!open)}
          aria-label={t.nav.menu}
        >
          <span className={`block h-px w-5 bg-white transition-transform ${open ? "translate-y-[7px] rotate-45" : ""}`} />
          <span className={`block h-px w-5 bg-white transition-opacity ${open ? "opacity-0" : ""}`} />
          <span className={`block h-px w-5 bg-white transition-transform ${open ? "-translate-y-[7px] -rotate-45" : ""}`} />
        </button>
      </nav>

      {open && (
        <div className="border-t border-[#222] bg-black px-6 py-6 md:hidden">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="block py-4 font-display text-sm tracking-[0.15em] text-[#888] hover:text-white"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </a>
          ))}
          <div className="mt-4 flex flex-col gap-3 border-t border-[#222] pt-6">
            <LanguageSwitcher />
            {authReady && user ? (
              <>
                <Link
                  href="/profile"
                  className="font-display text-xs tracking-widest text-[#888] hover:text-white"
                  onClick={() => setOpen(false)}
                >
                  {t.nav.profile}: {user.email}
                </Link>
                <button type="button" onClick={handleLogout} className="btn-outline w-full !text-xs">
                  {t.nav.logout}
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="btn-outline w-full !text-xs text-center" onClick={() => setOpen(false)}>
                  {t.nav.login}
                </Link>
                <Link
                  href="/login?mode=signup"
                  className="btn-accent w-full !text-xs text-center"
                  onClick={() => setOpen(false)}
                >
                  {t.nav.start}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
