"use client";

import { useEffect, useState } from "react";

/**
 * 히어로 매칭 「설명용」 일러스트
 * - 글자는 HTML(Inter + Noto)로만 — SVG text는 한글 fallback이 촌스러워짐
 * - 도형/선만 SVG
 */

type MatchNetworkIllustrationProps = {
  primaryLabel: string;
  secondaryLabel: string;
  stepAnalyze: string;
  stepConnect: string;
  stepDone: string;
  demoHint: string;
  tagAggression: string;
  tagRole: string;
  aiLabel: string;
};

type Step = 0 | 1 | 2;

function AvatarFace({ accent }: { accent: string }) {
  return (
    <>
      <circle r="34" fill="#15141C" stroke={accent} strokeWidth="2.8" />
      <circle cy={-8} r="10" fill={accent} fillOpacity="0.55" />
      <ellipse cy={14} rx="15" ry="10" fill={accent} fillOpacity="0.35" />
    </>
  );
}

export default function MatchNetworkIllustration({
  primaryLabel,
  secondaryLabel,
  stepAnalyze,
  stepConnect,
  stepDone,
  demoHint,
  tagAggression,
  tagRole,
  aiLabel,
}: MatchNetworkIllustrationProps) {
  const [step, setStep] = useState<Step>(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setStep(2);
      return;
    }
    const id = window.setInterval(() => {
      setStep((prev) => ((prev + 1) % 3) as Step);
    }, 2400);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  const you = { x: 130, y: 168 };
  const ai = { x: 260, y: 168 };
  const partner = { x: 390, y: 168 };

  const captions = [stepAnalyze, stepConnect, stepDone] as const;
  const captionColor = step === 2 ? "#FF8A93" : "#3DE0D0";

  const showTags = step === 0;
  const flowA = step === 0 ? 0.45 : 1;
  const flowB = step >= 1 ? 1 : 0.12;
  const partnerOp = step === 0 ? 0.3 : 1;
  const aiOp = step === 0 ? 0.65 : 1;
  const checkOp = step === 2 ? 1 : 0;

  // viewBox 520x280 기준 % 위치 → HTML 라벨 정렬
  const pct = (x: number, y: number) => ({
    left: `${(x / 520) * 100}%`,
    top: `${(y / 280) * 100}%`,
  });

  return (
    <div className="relative mx-auto w-full max-w-[560px] md:max-w-none">
      <div
        className={`match-story relative w-full origin-center scale-[0.78] md:scale-100 ${
          reduceMotion ? "" : "duo-float"
        }`}
      >
        <div className="mb-3 flex flex-col items-center gap-2">
          <span className="font-body rounded-md border border-white/20 px-2.5 py-1 text-[11px] font-semibold tracking-[0.12em] text-[#A8A6B0] uppercase">
            {demoHint}
          </span>
          <p
            key={step}
            className="match-caption font-headline min-h-[1.5rem] text-center text-[15px] font-bold tracking-[-0.01em]"
            style={{ color: captionColor }}
          >
            {captions[step]}
          </p>
        </div>

        <div className="relative w-full">
          <svg
            viewBox="0 0 520 280"
            className="h-auto w-full drop-shadow-[0_0_36px_rgba(61,224,208,0.25)]"
            role="img"
            aria-label={captions[step]}
          >
            <defs>
              <linearGradient id="matchLinkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#3DE0D0" />
                <stop offset="100%" stopColor="#FF4655" />
              </linearGradient>
              <marker
                id="arrowCyan"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#3DE0D0" />
              </marker>
            </defs>

            <line
              x1={you.x + 42}
              y1={you.y}
              x2={ai.x - 36}
              y2={ai.y}
              stroke="#3DE0D0"
              strokeOpacity="0.2"
              strokeWidth="2"
              markerEnd="url(#arrowCyan)"
            />
            <line
              x1={ai.x + 36}
              y1={ai.y}
              x2={partner.x - 42}
              y2={partner.y}
              stroke="#FF4655"
              strokeOpacity="0.15"
              strokeWidth="2"
            />

            <line
              x1={you.x + 42}
              y1={you.y}
              x2={ai.x - 36}
              y2={ai.y}
              stroke="#3DE0D0"
              strokeWidth="2.6"
              strokeLinecap="round"
              opacity={flowA}
            />
            <line
              x1={ai.x + 36}
              y1={ai.y}
              x2={partner.x - 42}
              y2={partner.y}
              stroke="url(#matchLinkGrad)"
              strokeWidth="2.8"
              strokeLinecap="round"
              opacity={flowB}
            />

            {showTags && (
              <g transform={`translate(${ai.x}, ${ai.y})`}>
                <circle
                  r="48"
                  fill="none"
                  stroke="#3DE0D0"
                  strokeWidth="1.5"
                  strokeOpacity="0.55"
                  strokeDasharray="4 6"
                  className={reduceMotion ? undefined : "match-calc-ring"}
                />
              </g>
            )}

            <g transform={`translate(${you.x}, ${you.y})`}>
              <AvatarFace accent="#3DE0D0" />
            </g>

            <g transform={`translate(${ai.x}, ${ai.y})`} opacity={aiOp}>
              <rect
                x="-32"
                y="-32"
                width="64"
                height="64"
                rx="16"
                fill="#15141C"
                stroke="#3DE0D0"
                strokeWidth="2.4"
              />
              {/* AI 영문은 HTML 라벨로 — SVG에는 도형만 */}
            </g>

            <g transform={`translate(${partner.x}, ${partner.y})`} opacity={partnerOp}>
              <AvatarFace accent="#FF4655" />
              <g opacity={checkOp}>
                <circle cx="24" cy="-24" r="12" fill="#FF4655" />
                <path
                  d="M18 -24 L22 -20 L30 -30"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          </svg>

          {/* HTML 라벨 — Inter(영) + Noto(한) 가 제대로 적용됨 */}
          <div className="pointer-events-none absolute inset-0">
            {/* AI 계산 칩 */}
            {showTags && (
              <>
                <span
                  className="font-body absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#3DE0D0]/70 bg-[#0c1c22]/95 px-2.5 py-1 text-[11px] font-bold tracking-wide text-[#3DE0D0] tabular-nums shadow-[0_0_16px_rgba(61,224,208,0.2)]"
                  style={pct(ai.x - 78, ai.y - 72)}
                >
                  {tagAggression}
                </span>
                <span
                  className="font-body absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[#3DE0D0]/55 bg-[#0c1c22]/95 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[#D2D0DA] shadow-[0_0_16px_rgba(61,224,208,0.12)]"
                  style={pct(ai.x + 78, ai.y - 72)}
                >
                  {tagRole}
                </span>
              </>
            )}

            <span
              className="font-headline absolute -translate-x-1/2 text-[14px] font-bold tracking-tight text-white"
              style={{
                left: pct(you.x, 0).left,
                top: `calc(${((you.y + 52) / 280) * 100}%)`,
              }}
            >
              {primaryLabel}
            </span>

            <div
              className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
              style={{ ...pct(ai.x, ai.y), opacity: aiOp }}
            >
              <span className="font-headline text-[15px] font-extrabold tracking-[0.04em] text-[#3DE0D0]">
                AI
              </span>
            </div>
            <span
              className="font-body absolute -translate-x-1/2 text-[12px] font-semibold tracking-wide text-[#A8A6B0]"
              style={{
                left: pct(ai.x, 0).left,
                top: `calc(${(ai.y + 52) / 280 * 100}%)`,
                opacity: aiOp,
              }}
            >
              {aiLabel}
            </span>

            <span
              className="font-headline absolute -translate-x-1/2 text-[14px] font-bold tracking-tight text-white"
              style={{
                left: pct(partner.x, 0).left,
                top: `calc(${(partner.y + 52) / 280 * 100}%)`,
                opacity: partnerOp,
              }}
            >
              {secondaryLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
