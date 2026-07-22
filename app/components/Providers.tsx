"use client";

import { LanguageProvider } from "../context/LanguageContext";
import { useAuth } from "@/lib/auth/useAuth";
import PresenceHeartbeat from "./PresenceHeartbeat";

function PresenceLayer({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <>
      {user ? <PresenceHeartbeat user={user} /> : null}
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
