"use client";

import { LanguageProvider } from "../context/LanguageContext";
import { useAuth } from "@/lib/auth/useAuth";
import OnboardingGate from "./OnboardingGate";
import PresenceHeartbeat from "./PresenceHeartbeat";

function PresenceLayer({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <>
      {user ? <PresenceHeartbeat user={user} /> : null}
      {/* 홈뿐 아니라 /profile 등에서도 온보딩 미완료면 /onboarding으로 보냄 */}
      <OnboardingGate />
      {children}
    </>
  );
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <PresenceLayer>{children}</PresenceLayer>
    </LanguageProvider>
  );
}
