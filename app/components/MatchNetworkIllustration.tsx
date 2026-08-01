"use client";

import { useEffect, useState } from "react";

/**
 * 히어로 매칭 일러스트 (프리미엄 글래스 스테이지)
 * - 맵/격자 없음 → 소프트 앰비언트 + 글래스 패널
 * - 나 → 매칭 엔진 → 듀오 3단계
 * - 요원 아이콘은 valorant-api CDN, 듀오는 스핀 후 채택
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
  engMark: string;
  aiLabel: string;
};

type Step = 0 | 1 | 2;

// media.valorant-api.com — 공개 CDN (API 키 불필요). 프론트에 넣어도 되는 정적 이미지 URL.
const AGENT_ICONS = [
  "https://media.valorant-api.com/agents/add6443a-41bd-e414-f6ad-e58d267f4e95/displayicon.png", // Jett
  "https://media.valorant-api.com/agents/bb2a4828-46eb-8cd1-e765-15848195d751/displayicon.png", // Neon
  "https://media.valorant-api.com/agents/a3bfb853-43b2-7238-a4f1-ad90e9e46bcc/displayicon.png", // Reyna
  "https://media.valorant-api.com/agents/f94c3b30-42be-e959-889c-5aa313dba261/displayicon.png", // Raze
  "https://media.valorant-api.com/agents/1dbf2edd-4729-0984-3115-daa5eed44993/displayicon.png", // Clove
  "https://media.valorant-api.com/agents/117ed9e3-49f3-6512-3ccf-0cada7e3823b/displayicon.png", // Cypher
  "https://media.valorant-api.com/agents/5f8d3a7f-467b-97f3-062c-13acf203c006/displayicon.png", // Breach
  "https://media.valorant-api.com/agents/569fdd95-4d10-43ab-ca70-79becc718b46/displayicon.png", // Sage
  "https://media.valorant-api.com/agents/320b2a48-4d9b-a075-30f1-1f93a9b638fa/displayicon.png", // Sova
  "https://media.valorant-api.com/agents/8e253930-4c05-31dd-1b6c-968525494517/displayicon.png", // Omen
] as const;

function AgentMarker({
  x,
  y,
  icon,
  accent,
  opacity = 1,
  size = 56,
  clipId,
}: {
  x: number;
  y: number;
  icon: string;
  accent: string;
  opacity?: number;
  size?: number;
  clipId: string;
}) {
  const half = size / 2;
  const r = 10;
  const inset = 3;
  return (
    <g transform={`translate(${x}, ${y})`} opacity={opacity}>
      <defs>
        {/* 요원 사진을 둥근 사각으로 자름 (valoplant 마커 느낌) */}
        <clipPath id={clipId}>
          <rect
            x={-half + inset}
            y={-half + inset}
            width={size - inset * 2}
            height={size - inset * 2}
            rx={r - 2}
          />
        </clipPath>
      </defs>
      {/* 이중 아우터 링 제거 — 원형 잔상처럼 보였음 */}
      <rect
        x={-half}
        y={-half}
        width={size}
        height={size}
        rx={r}
        fill="#0a1218"
        stroke={accent}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
      <image
        href={icon}
        x={-half + inset}
        y={-half + inset}
        width={size - inset * 2}
        height={size - inset * 2}
        preserveAspectRatio="xMidYMid slice"
        clipPath={`url(#${clipId})`}
      />
      {/* 위치 핀 (valoplant 스타일 삼각형) */}
      <path
        d={`M0 ${half + 6} L-6 ${half + 16} L6 ${half + 16} Z`}
        fill="#fff"
        fillOpacity="0.9"
      />
    </g>
  );
}

export default function MatchNetworkIllustration({
  primaryLabel,
  secondaryLabel,
  stepAnalyze,
  stepConnect,
  stepDone,
  // demoHint / tagAggression / tagRole — UI에서 제거, type·Hero props만 호환 유지
  engMark,
  aiLabel,
}: MatchNetworkIllustrationProps) {
  const [step, setStep] = useState<Step>(0);
  const [youIdx, setYouIdx] = useState(0);
  // 듀오 후보가 빠르게 돌아가는 인덱스 (아직 확정 전)
  const [spinIdx, setSpinIdx] = useState(1);
  // step 2에서 딱 한 명 채택된 인덱스
  const [lockedIdx, setLockedIdx] = useState(1);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // 3단계 스토리 루프
  useEffect(() => {
    if (reduceMotion) {
      setStep(2);
      return;
    }
    const id = window.setInterval(() => {
      setStep((prev) => {
        const next = ((prev + 1) % 3) as Step;
        // 새 루프 시작 → "나" 요원만 다음으로 (듀오는 다시 스핀)
        if (next === 0) {
          setYouIdx((y) => (y + 1) % AGENT_ICONS.length);
        }
        return next;
      });
    }, 2800);
    return () => window.clearInterval(id);
  }, [reduceMotion]);

  // 듀오 슬롯머신: step 0~1에서 빠르게 돌리다가, step 2에서 멈춤
  useEffect(() => {
    if (reduceMotion || step === 2) return;
    // 분석 중엔 빠르게, 연결 중엔 조금 느리게 (채택 직전 느낌)
    const ms = step === 0 ? 120 : 200;
    const id = window.setInterval(() => {
      setSpinIdx((prev) => {
        let next = (prev + 1) % AGENT_ICONS.length;
        // "나"와 같은 얼굴이 후보에 안 나오게
        if (next === youIdx) next = (next + 1) % AGENT_ICONS.length;
        return next;
      });
    }, ms);
    return () => window.clearInterval(id);
  }, [step, reduceMotion, youIdx]);

  // 완료 단계 진입 순간 → 지금 돌고 있던 얼굴을 확정
  useEffect(() => {
    if (step !== 2) return;
    setLockedIdx(() => {
      let pick = spinIdx;
      if (pick === youIdx) pick = (pick + 1) % AGENT_ICONS.length;
      return pick;
    });
  }, [step, spinIdx, youIdx]);

  const youIcon = AGENT_ICONS[youIdx];
  // 확정 전: 스핀 얼굴 / 확정 후: 잠긴 얼굴
  const duoIcon =
    step === 2 || reduceMotion
      ? AGENT_ICONS[lockedIdx]
      : AGENT_ICONS[spinIdx];
  const duoLocked = step === 2 || reduceMotion;

  const you = { x: 130, y: 310 };
  const eng = { x: 280, y: 250 };
  const partner = { x: 430, y: 310 };

  const captions = [stepAnalyze, stepConnect, stepDone] as const;
  const captionColor = step === 2 ? "#FF8A93" : "#3DE0D0";

  const flowA = step === 0 ? 0.5 : 1;
  const flowB = step >= 1 ? 1 : 0.12;
  // 스핀 중에도 얼굴이 보이게 (너무 투명하면 순환이 안 보임)
  const partnerOp = step === 0 ? 0.55 : 1;
  const engOp = step === 0 ? 0.8 : 1;
  const checkOp = duoLocked ? 1 : 0;

  return (
    <div className="relative mx-auto w-full max-w-[520px] md:max-w-none">
      <div className="relative w-full overflow-visible">
        <svg
          viewBox="0 0 560 560"
          className={`h-auto w-full overflow-visible ${reduceMotion ? "" : "vp-scene-float"}`}
          role="img"
          aria-label={captions[step]}
        >
          <defs>
            <linearGradient id="vpLinkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3DE0D0" />
              <stop offset="100%" stopColor="#FF4655" />
            </linearGradient>
            {/* 글래스 패널: 위→아래 깊이감 */}
            <linearGradient id="vpGlassBody" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#121820" stopOpacity="0.72" />
              <stop offset="45%" stopColor="#0a1016" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#05080b" stopOpacity="0.2" />
            </linearGradient>
            {/* 상단 하이라이트 시트 */}
            <linearGradient id="vpGlassSheen" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.07" />
              <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="vpEngFill" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#1e3a3f" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#0d1418" stopOpacity="0.98" />
            </radialGradient>
          </defs>

          {/* ── 큰 글래스 패널 ── */}
          <rect x="48" y="72" width="464" height="396" rx="28" fill="url(#vpGlassBody)" />
          <rect x="48" y="72" width="464" height="130" rx="28" fill="url(#vpGlassSheen)" />

          {/*
            패널 맨 위 넓은 띠 — 여기가 말한 「이 부분」
            예시 + 단계 문구를 가시성 있게 배치
          */}
          <rect
            x="72"
            y="92"
            width="416"
            height="52"
            rx="14"
            fill="#05080b"
            fillOpacity="0.72"
            stroke="#ffffff"
            strokeOpacity="0.08"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          <foreignObject x="72" y="92" width="416" height="52">
            {/* React/TS에서 div에 xmlns 못 씀 → 제거 (foreignObject 안 HTML은 그대로 동작) */}
            <div className="match-illust-text flex h-full items-center justify-center px-4">
              <span
                key={step}
                className="match-caption font-body text-center text-[15px] font-bold leading-none tracking-tight md:text-[16px]"
                style={{ color: captionColor }}
              >
                {captions[step]}
              </span>
            </div>
          </foreignObject>

          {/* 연결선 */}
          <line
            x1={you.x + 36}
            y1={you.y - 10}
            x2={eng.x - 48}
            y2={eng.y + 10}
            stroke="#3DE0D0"
            strokeWidth="2.4"
            strokeLinecap="round"
            opacity={flowA}
          />
          <line
            x1={eng.x + 48}
            y1={eng.y + 10}
            x2={partner.x - 36}
            y2={partner.y - 10}
            stroke="url(#vpLinkGrad)"
            strokeWidth="2.6"
            strokeLinecap="round"
            opacity={flowB}
          />

          {/* 에너지 도트 */}
          {!reduceMotion && step !== 2 && (
            <circle r="3.2" fill="#3DE0D0" className="vp-energy-a">
              <animateMotion
                dur="1.4s"
                repeatCount="indefinite"
                path={`M${you.x + 36},${you.y - 10} L${eng.x - 48},${eng.y + 10}`}
              />
            </circle>
          )}
          {!reduceMotion && step >= 1 && (
            <circle r="3.2" fill="#FF6B75" className="vp-energy-b">
              <animateMotion
                dur="1.4s"
                repeatCount="indefinite"
                begin="0.15s"
                path={`M${eng.x + 48},${eng.y + 10} L${partner.x - 36},${partner.y - 10}`}
              />
            </circle>
          )}

          {/* ── 매칭 엔진 (중앙) ── */}
          <g transform={`translate(${eng.x}, ${eng.y})`} opacity={engOp}>
            <rect
              x="-42"
              y="-42"
              width="84"
              height="84"
              rx="18"
              fill="#3DE0D0"
              fillOpacity="0.06"
            />
            <rect
              x="-36"
              y="-36"
              width="72"
              height="72"
              rx="16"
              fill="url(#vpEngFill)"
              stroke="#3DE0D0"
              strokeWidth="2.2"
              strokeOpacity="0.9"
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x="-30"
              y="-30"
              width="60"
              height="18"
              rx="8"
              fill="#fff"
              fillOpacity="0.06"
            />
            <text
              textAnchor="middle"
              y="6"
              fill="#3DE0D0"
              fontSize="15"
              fontWeight="800"
              letterSpacing="0.16em"
              style={{ fontFamily: "var(--font-inter), var(--font-noto), sans-serif" }}
            >
              {engMark}
            </text>
          </g>

          {/* 나 */}
          <AgentMarker
            x={you.x}
            y={you.y}
            icon={youIcon}
            accent="#3DE0D0"
            clipId="vpClipYou"
          />

          {/*
            듀오: 바깥 g = SVG translate(위치 고정)
            안쪽 g = CSS scale 애니 — 합치면 (0,0)에 원이 뜨는 버그 생김
            step 0~1: 요원 순환 / step 2: 한 명 채택 + 팝
          */}
          <g transform={`translate(${partner.x}, ${partner.y})`} opacity={partnerOp}>
            <g
              className={
                !reduceMotion && duoLocked ? "match-partner-clear" : undefined
              }
            >
              <AgentMarker
                key={duoLocked ? `lock-${lockedIdx}` : `spin-${spinIdx}`}
                x={0}
                y={0}
                icon={duoIcon}
                accent="#FF4655"
                clipId="vpClipDuo"
              />
              <g opacity={checkOp} transform="translate(28, -28)">
                <circle r="12" fill="#FF4655" />
                <path
                  d="M-6 0 L-2 4 L7 -6"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            </g>
          </g>

          {/* 라벨 — SVG text (스케일 안에서도 벡터라 비교적 선명) */}
          <text
            x={you.x}
            y={you.y + 58}
            textAnchor="middle"
            fill="#fff"
            fontSize="13"
            fontWeight="700"
            style={{ fontFamily: "var(--font-inter), var(--font-noto), sans-serif" }}
          >
            {primaryLabel}
          </text>
          <text
            x={eng.x}
            y={eng.y + 62}
            textAnchor="middle"
            fill="#A8A6B0"
            fontSize="11"
            fontWeight="600"
            opacity={engOp}
            style={{ fontFamily: "var(--font-inter), var(--font-noto), sans-serif" }}
          >
            {aiLabel}
          </text>
          <text
            x={partner.x}
            y={partner.y + 58}
            textAnchor="middle"
            fill="#fff"
            fontSize="13"
            fontWeight="700"
            opacity={partnerOp}
            style={{ fontFamily: "var(--font-inter), var(--font-noto), sans-serif" }}
          >
            {secondaryLabel}
          </text>
        </svg>
      </div>
    </div>
  );
}
