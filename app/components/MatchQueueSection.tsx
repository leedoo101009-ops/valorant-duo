"use client";

import { useLanguage } from "../context/LanguageContext";
import { useMatchQueue } from "../hooks/useMatchQueue";
import MatchQueueControls from "./MatchQueueControls";

/**
 * 매칭 큐 UI — Hero에서 분리
 * 로직(useMatchQueue)은 그대로 두고, 랜딩 히어로는 프레젠테이션만 담당
 */
export default function MatchQueueSection() {
  const { t } = useLanguage();
  const {
    status,
    actionLoading,
    pendingAction,
    joinQueue,
    leaveQueue,
    dismissMatch,
    cancelSetup,
    markSetupReady,
    updateConnection,
    submitReview,
    acceptPartnerNoVoice,
    declinePartnerNoVoice,
  } = useMatchQueue();

  return (
    <section id="match" className="scroll-mt-24 border-t border-white/5 bg-black py-16 md:py-24">
      <div className="mx-auto max-w-[900px] px-6 lg:px-12">
        <p className="font-body text-center text-sm text-duo-muted">{t.hero.matchSectionLabel}</p>
        <h2 className="mt-3 text-center font-headline text-2xl font-bold text-white md:text-3xl">
          {t.hero.matchSectionTitle}
        </h2>
        <div className="mt-10">
          <MatchQueueControls
            status={status}
            actionLoading={actionLoading}
            pendingAction={pendingAction}
            joinQueue={joinQueue}
            leaveQueue={leaveQueue}
            dismissMatch={dismissMatch}
            cancelSetup={cancelSetup}
            markSetupReady={markSetupReady}
            updateConnection={updateConnection}
            submitReview={submitReview}
            acceptPartnerNoVoice={acceptPartnerNoVoice}
            declinePartnerNoVoice={declinePartnerNoVoice}
          />
        </div>
      </div>
    </section>
  );
}
