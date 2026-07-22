"use client";

// 인증 관련 로직을 UI 컴포넌트에서 분리
//
// 왜 훅으로 모으나?
//   Navbar / Providers / MatchQueueControls 가 각자 getUser + onAuthStateChange 를
//   복붙하면 구독이 여러 번 생기고, 로그인 페이지와도 코드가 갈라집니다.
//   한 곳에서 세션 구독 + 로그인/로그아웃만 담당하게 둡니다.
//
// 주의: 이 파일은 "use client" — 브라우저에서만 동작하는 훅입니다.
//   API 키/서비스 롤 키는 절대 여기 두지 마세요. (브라우저로 노출됨)

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { ensureProfile } from "@/lib/supabase/profile";

export type AuthActionResult = {
  ok: boolean;
  // Supabase가 주는 raw message (로그인 폼에서 표시용)
  errorMessage?: string;
  // OAuth 등에서 번역 키로 쓸 때
  errorKey?: "oauth_failed";
};

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  // getUser() 끝나기 전엔 "비로그인"으로 깜빡이지 않게
  const [authReady, setAuthReady] = useState(false);

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

  // 이메일 + 비밀번호 로그인
  async function signInWithPassword(
    email: string,
    password: string,
  ): Promise<AuthActionResult> {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return { ok: false, errorMessage: error.message };
    }

    if (data.user) {
      await ensureProfile(supabase, data.user);
    }

    return { ok: true };
  }

  // 이메일 회원가입
  async function signUp(email: string, password: string): Promise<AuthActionResult> {
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      return { ok: false, errorMessage: error.message };
    }

    if (data.user) {
      await ensureProfile(supabase, data.user);
    }

    return { ok: true };
  }

  // Google OAuth — 성공 시 브라우저가 Google로 이동하므로 호출측에서 loading을 끄지 않음
  async function signInWithGoogle(): Promise<AuthActionResult> {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      // Supabase 내부 문구를 그대로 노출하지 않음 (설정 정보 힌트 방지)
      return { ok: false, errorKey: "oauth_failed" };
    }

    return { ok: true };
  }

  async function signOut(): Promise<void> {
    const supabase = createClient();
    await supabase.auth.signOut();
  }

  return {
    user,
    authReady,
    signInWithPassword,
    signUp,
    signInWithGoogle,
    signOut,
  };
}
