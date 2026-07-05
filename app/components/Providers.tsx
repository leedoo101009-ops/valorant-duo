"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LanguageProvider } from "../context/LanguageContext";
import { createClient } from "@/lib/supabase/client";
import PresenceHeartbeat from "./PresenceHeartbeat";

function PresenceLayer({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

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
