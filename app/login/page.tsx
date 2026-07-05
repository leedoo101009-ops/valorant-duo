"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useLanguage } from "../context/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import { ensureProfile } from "@/lib/supabase/profile";

type AuthMode = "login" | "signup";

function LoginForm() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "signup" ? "signup" : "login";

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setIsError(false);

    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });

      if (error) {
        setIsError(true);
        setMessage(error.message);
        setLoading(false);
        return;
      }

      if (data.user) {
        await ensureProfile(supabase, data.user);
      }

      setMessage(t.auth.signupSuccess);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setIsError(true);
      setMessage(error.message);
      setLoading(false);
      return;
    }

    if (data.user) {
      await ensureProfile(supabase, data.user);
    }

    router.push("/");
    router.refresh();
  }

  return (
    <div className="panel w-full max-w-md p-8 lg:p-10">
      <p className="font-display text-xs tracking-[0.3em] text-[#ff4655]">{t.auth.label}</p>
      <h1 className="mt-4 font-display text-3xl font-bold uppercase">
        {mode === "login" ? t.auth.loginTitle : t.auth.signupTitle}
      </h1>
      <p className="mt-3 text-sm text-[#888]">{t.auth.subtitle}</p>

      <div className="mt-8 flex border border-[#333]">
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setMessage(null);
          }}
          className={`flex-1 py-3 font-display text-xs tracking-[0.2em] transition-colors ${
            mode === "login" ? "bg-[#ff4655] text-white" : "text-[#888] hover:text-white"
          }`}
        >
          {t.auth.loginTab}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode("signup");
            setMessage(null);
          }}
          className={`flex-1 py-3 font-display text-xs tracking-[0.2em] transition-colors ${
            mode === "signup" ? "bg-[#ff4655] text-white" : "text-[#888] hover:text-white"
          }`}
        >
          {t.auth.signupTab}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        <div>
          <label htmlFor="email" className="mb-2 block font-display text-[10px] tracking-widest text-[#555]">
            {t.auth.email}
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-2 block font-display text-[10px] tracking-widest text-[#555]">
            {t.auth.password}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
            placeholder="••••••••"
          />
        </div>

        {message && (
          <p className={`text-sm ${isError ? "text-[#ff4655]" : "text-[#0fbcbf]"}`}>{message}</p>
        )}

        <button type="submit" disabled={loading} className="btn-accent w-full !py-4 disabled:opacity-50">
          {loading
            ? t.auth.loading
            : mode === "login"
              ? t.auth.loginButton
              : t.auth.signupButton}
        </button>
      </form>

      <Link href="/" className="mt-8 inline-block font-display text-xs tracking-widest text-[#555] hover:text-white">
        ← {t.auth.backHome}
      </Link>
    </div>
  );
}

export default function LoginPage() {
  const { t } = useLanguage();

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-black px-6 py-24">
      <div className="absolute inset-0 bg-map-grid opacity-60" />
      <div className="absolute top-6 right-6 z-10">
        <LanguageSwitcher />
      </div>

      <div className="relative w-full max-w-md">
        <Suspense
          fallback={
            <div className="panel p-8 text-center font-display text-sm tracking-widest text-[#888]">
              {t.auth.loading}
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
