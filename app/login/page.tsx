"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "@/lib/auth/useAuth";

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
  const { signInWithPassword, signUp, signInWithGoogle } = useAuth();
  // URL이 단일 출처 — 뒤로가기/앞으로가기도 화면과 자동 동기화
  const mode: AuthMode =
    searchParams.get("mode") === "signup" ? "signup" : "login";
  const hasAuthError = searchParams.get("error") === "auth";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // 회원가입 전용 — 로그인 UI에는 안 보임
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  // 가입/로그인은 됐는데 약관 기록만 실패 → 재시도 버튼 표시
  const [needsTermsRetry, setNeedsTermsRetry] = useState(false);
  const [message, setMessage] = useState<string | null>(
    hasAuthError ? t.auth.oauthFailed : null,
  );
  const [isError, setIsError] = useState(hasAuthError);

  function switchMode(next: AuthMode) {
    setMessage(null);
    setIsError(false);
    setNeedsTermsRetry(false);
    // 화면 바꿀 때 회원가입용 입력만 초기화 (이메일은 남겨 둠)
    setConfirmPassword("");

    // URL만 바꾸면 mode가 따라옴 (?mode=signup 공유·뒤로가기 가능)
    const params = new URLSearchParams(searchParams.toString());
    if (next === "signup") {
      params.set("mode", "signup");
    } else {
      params.delete("mode");
    }
    const qs = params.toString();
    router.replace(qs ? `/login?${qs}` : "/login", { scroll: false });
  }

  async function handleGoogleLogin() {
    setOauthLoading(true);
    setMessage(null);
    setIsError(false);
    setNeedsTermsRetry(false);

    // Google → /auth/callback 에서 미기록 유저면 동의 기록
    const result = await signInWithGoogle();

    if (!result.ok) {
      setIsError(true);
      setMessage(t.auth.oauthFailed);
      setOauthLoading(false);
    }
    // 성공 시 브라우저가 Google로 이동하므로 여기서 loading을 끄지 않습니다.
  }

  // 로그인·가입 공통: 온보딩 안 끝났으면 /onboarding, 끝났으면 홈
  async function redirectAfterAuth() {
    try {
      const statusRes = await fetch("/api/onboarding");
      const status = (await statusRes.json()) as {
        ok?: boolean;
        onboardingCompleted?: boolean;
      };
      const done = statusRes.ok && status.ok && status.onboardingCompleted === true;
      router.push(done ? "/" : "/onboarding");
    } catch {
      router.push("/onboarding");
    }
    router.refresh();
  }

  // 동의 기록 성공해야 다음 화면으로. 실패 시 안내 + 재시도.
  async function acceptTermsAndContinue() {
    setLoading(true);
    setMessage(null);
    setIsError(false);

    try {
      const termsRes = await fetch("/api/terms/accept", { method: "POST" });
      if (!termsRes.ok) {
        setIsError(true);
        setMessage(t.auth.termsRecordFailed);
        setNeedsTermsRetry(true);
        return;
      }

      setNeedsTermsRetry(false);
      await redirectAfterAuth();
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 약관 기록만 남은 상태면 가입을 다시 안 하고 재시도만
    if (needsTermsRetry) {
      await acceptTermsAndContinue();
      return;
    }

    setLoading(true);
    setMessage(null);
    setIsError(false);

    if (mode === "signup") {
      // 비밀번호 확인 — 로블록스 가입처럼 “한 번 더 확인”
      if (password !== confirmPassword) {
        setIsError(true);
        setMessage(t.auth.passwordMismatch);
        setLoading(false);
        return;
      }

      const result = await signUp(email, password);

      if (!result.ok) {
        setIsError(true);
        setMessage(result.errorMessage ?? t.auth.oauthFailed);
        setLoading(false);
        return;
      }

      // Confirm email OFF면 signUp만으로 세션이 생김.
      // 혹시 세션이 없으면 같은 비번으로 한 번 더 로그인해서 세션을 확보.
      const loginResult = await signInWithPassword(email, password);
      if (!loginResult.ok) {
        // 아직 이메일 인증이 켜져 있으면 여기로 옴 → 메일 확인 안내
        setIsError(false);
        setMessage(t.auth.signupSuccess);
        setLoading(false);
        return;
      }

      setLoading(false);
      await acceptTermsAndContinue();
      return;
    }

    const result = await signInWithPassword(email, password);

    if (!result.ok) {
      setIsError(true);
      setMessage(result.errorMessage ?? t.auth.oauthFailed);
      setLoading(false);
      return;
    }

    setLoading(false);
    await acceptTermsAndContinue();
  }

  const busy = loading || oauthLoading;
  const isSignup = mode === "signup";

  // 회원가입은 필드가 많아서 여백·입력을 압축. 로그인 레이아웃은 기존 유지.
  const inputClass = isSignup ? "auth-input auth-input--compact" : "auth-input";
  const labelClass =
    "mb-1.5 block font-body text-[11px] font-semibold tracking-[0.12em] text-[#8B8894] uppercase";

  return (
    <div
      className={`w-full max-w-md rounded-2xl border bg-[rgba(4,7,11,0.92)] shadow-[0_24px_70px_rgba(0,0,0,0.65)] backdrop-blur-md ${
        isSignup
          ? "border-[#3DE0D0]/25 p-5 sm:p-6"
          : "border-white/[0.07] p-8 lg:p-10"
      }`}
    >
      <div className={`flex items-center gap-3 ${isSignup ? "mb-3" : "mb-6"}`}>
        <span
          className={`inline-flex items-center justify-center rounded-md bg-[#FF4655] font-headline font-black text-white ${
            isSignup ? "h-8 w-8 text-sm" : "h-10 w-10 text-base"
          }`}
        >
          D
        </span>
        <span
          className={`font-headline font-extrabold tracking-tight text-white ${
            isSignup ? "text-lg" : "text-xl"
          }`}
        >
          Duorant
        </span>
      </div>

      <p className="font-body text-[11px] font-semibold tracking-[0.16em] text-[#3DE0D0] uppercase">
        {t.auth.label}
      </p>
      <h1
        className={`font-headline font-bold tracking-tight text-[#F5F5F7] ${
          isSignup ? "mt-1 text-xl" : "mt-2 text-[1.75rem]"
        }`}
      >
        {isSignup ? t.auth.signupTitle : t.auth.loginTitle}
      </h1>
      {/* 회원가입은 스크롤 줄이려고 서브카피 숨김 — 로그인만 기존 문구 유지 */}
      {!isSignup && (
        <p className="mt-2 font-body text-sm leading-relaxed text-[#8B8894]">
          {t.auth.subtitle}
        </p>
      )}

      {/* 노션식: 탭 없이 로그인/가입 화면을 따로 보여 줌 */}
      <form
        onSubmit={handleSubmit}
        className={isSignup ? "mt-5 space-y-3" : "mt-8 space-y-5"}
      >
        <div>
          <label htmlFor="email" className={labelClass}>
            {t.auth.email}
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label htmlFor="password" className={labelClass}>
            {t.auth.password}
          </label>
          <input
            id="password"
            type="password"
            required
            minLength={6}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            placeholder="••••••••"
          />
          {/* 회원가입만 비밀번호 규칙 힌트 */}
          {isSignup && (
            <p className="mt-1 font-body text-[11px] text-[#8B8894]">
              {t.auth.passwordHint}
            </p>
          )}
        </div>

        {/* 회원가입만: 비밀번호 확인 */}
        {isSignup && (
          <div>
            <label htmlFor="confirmPassword" className={labelClass}>
              {t.auth.confirmPassword}
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              placeholder="••••••••"
            />
          </div>
        )}

        {message && (
          <p
            className={`font-body text-sm ${
              isError ? "text-[#FF4655]" : "text-[#3DE0D0]"
            }`}
          >
            {message}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className={`btn-hero-primary btn-hero-primary--soft-glow w-full disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:transform-none disabled:hover:filter-none ${
            isSignup ? "!py-2.5" : "!py-3.5"
          }`}
        >
          {loading
            ? t.auth.loading
            : needsTermsRetry
              ? t.auth.termsRetry
              : isSignup
                ? t.auth.signupButton
                : t.auth.loginButton}
        </button>
      </form>

      <div className={`flex items-center gap-3 ${isSignup ? "mt-3" : "mt-6"}`}>
        <div className="h-px flex-1 bg-white/10" />
        <span className="font-body text-[11px] font-semibold tracking-[0.14em] text-[#8B8894] uppercase">
          {t.auth.orDivider}
        </span>
        <div className="h-px flex-1 bg-white/10" />
      </div>

      {/* Google OAuth — 기능 동일, 글래스 버튼만 교체 */}
      <button
        type="button"
        onClick={() => void handleGoogleLogin()}
        disabled={busy}
        className={`flex w-full items-center justify-center gap-3 rounded-full border border-white/10 bg-black/35 font-body text-sm font-semibold text-[#F5F5F7] transition-[border-color,background] duration-[250ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-[#3DE0D0]/45 hover:bg-[rgba(61,224,208,0.06)] disabled:cursor-not-allowed disabled:opacity-50 ${
          isSignup ? "mt-3 py-2.5" : "mt-6 py-3.5"
        }`}
      >
        <GoogleIcon />
        <span>
          {oauthLoading
            ? t.auth.loading
            : isSignup
              ? t.auth.googleSignupButton
              : t.auth.googleButton}
        </span>
      </button>

      {/* 노션처럼: 「신규 사용자이신가요? 가입하기」/「이미 계정이 있으신가요? 로그인」 */}
      <p
        className={`text-center font-body text-sm text-[#8B8894] ${
          isSignup ? "mt-4" : "mt-6"
        }`}
      >
        {isSignup ? t.auth.switchToLoginPrompt : t.auth.switchToSignupPrompt}{" "}
        <button
          type="button"
          onClick={() => switchMode(isSignup ? "login" : "signup")}
          className="font-semibold text-[#3DE0D0] underline underline-offset-2 transition-colors hover:text-[#F5F5F7]"
        >
          {isSignup ? t.auth.switchToLogin : t.auth.switchToSignup}
        </button>
      </p>

      {/* 로그인·가입 공통: 계속하면 약관 동의로 간주 (노션식) */}
      <p className="mt-4 text-center font-body text-[11px] leading-relaxed text-[#6E6B76]">
        {t.auth.termsImpliedBefore}
        <Link
          href="/terms"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#8B8894] underline underline-offset-2 hover:text-[#3DE0D0]"
        >
          {t.auth.termsOfService}
        </Link>
        {t.auth.termsImpliedAnd}
        <Link
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#8B8894] underline underline-offset-2 hover:text-[#3DE0D0]"
        >
          {t.auth.privacyPolicy}
        </Link>
        {t.auth.termsImpliedAfter}
      </p>

      <Link
        href="/"
        className={`inline-block font-body font-medium text-[#8B8894] transition-colors hover:text-[#3DE0D0] ${
          isSignup ? "mt-3 text-xs" : "mt-6 text-sm"
        }`}
      >
        ← {t.auth.backHome}
      </Link>
    </div>
  );
}

export default function LoginPage() {
  const { t } = useLanguage();

  return (
    <div className="bg-hero-duo relative flex min-h-screen items-center justify-center overflow-x-hidden px-6 py-8 sm:py-12">
      {/* 랜딩과 같은 앰비언트 글로우 */}
      {/* 랜딩보다 글로우를 약하게 — 더 어두운 분위기 */}
      <div
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden opacity-45"
        aria-hidden="true"
      >
        <div className="hero-glow hero-glow-purple" />
        <div className="hero-glow hero-glow-blue" />
        <div className="hero-glow hero-glow-red" />
        <div className="hero-glow hero-glow-red-soft" />
      </div>
      <div className="pointer-events-none absolute inset-0 z-0 bg-black/35" aria-hidden="true" />

      <div className="absolute top-6 right-6 z-10 md:top-8 md:right-10">
        <LanguageSwitcher />
      </div>

      <div className="relative z-[1] w-full max-w-md">
        <Suspense
          fallback={
            <div className="rounded-2xl border border-white/[0.07] bg-[rgba(4,7,11,0.92)] p-8 text-center font-body text-sm text-[#8B8894] backdrop-blur-md">
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
