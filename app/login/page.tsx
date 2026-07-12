"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useLanguage } from "../context/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import { ensureProfile } from "@/lib/supabase/profile";

type AuthMode = "login" | "signup";

function GoogleIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function LoginForm() {
  const { t } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialMode = searchParams.get("mode") === "signup" ? "signup" : "login";
  const hasAuthError = searchParams.get("error") === "auth";

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(
    hasAuthError ? t.auth.oauthFailed : null,
  );
  const [isError, setIsError] = useState(hasAuthError);

  async function handleGoogleLogin() {
    setOauthLoading(true);
    setMessage(null);
    setIsError(false);

    const supabase = createClient();
    // Google 로그인 → Supabase가 /auth/callback 으로 돌려보냄
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setIsError(true);
      // Supabase 내부 에러 문구를 그대로 노출하지 않습니다 (설정 정보 힌트 방지)
      setMessage(t.auth.oauthFailed);
      setOauthLoading(false);
    }
    // 성공 시 브라우저가 Google로 이동하므로 여기서 loading을 끄지 않습니다.
  }

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

  const busy = loading || oauthLoading;

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

        <button type="submit" disabled={busy} className="btn-accent w-full !py-4 disabled:opacity-50">
          {loading
            ? t.auth.loading
            : mode === "login"
              ? t.auth.loginButton
              : t.auth.signupButton}
        </button>
      </form>

      <div className="mt-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-[#333]" />
        <span className="font-display text-[10px] tracking-widest text-[#555]">{t.auth.orDivider}</span>
        <div className="h-px flex-1 bg-[#333]" />
      </div>

      <button
        type="button"
        onClick={() => void handleGoogleLogin()}
        disabled={busy}
        className="btn-outline mt-6 flex w-full items-center justify-center gap-3 !py-4 disabled:opacity-50"
      >
        <GoogleIcon />
        <span>{oauthLoading ? t.auth.loading : t.auth.googleButton}</span>
      </button>

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
