import type { Config } from "tailwindcss";

/**
 * Duorant UI design tokens (feature/ui-renewal)
 *
 * Tailwind v4는 globals.css 의 @theme 이 실제 소스입니다.
 * 이 파일은 토큰을 한곳에 모아 두고, 팀/에디터에서 찾기 쉽게 둡니다.
 * CSS @theme 과 값이 어긋나면 @theme 쪽을 우선하세요.
 */
const config = {
  theme: {
    extend: {
      colors: {
        duo: {
          ink: "#0B0B0D",
          dusk: "#121014",
          ember: "#2A1014",
          crimson: "#4A1520",
          accent: "#FF4655",
          teal: "#3DE0D0",
          "teal-deep": "#163F3C",
          muted: "#C4C2CC",
          "muted-soft": "#9B98A6",
          border: "#3F3D4A",
          card: "rgba(22, 22, 28, 0.88)",
          void: "#000000",
        },
      },
      fontFamily: {
        headline: ["var(--font-inter)", "var(--font-noto)", "sans-serif"],
        body: ["var(--font-inter)", "var(--font-noto)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "monospace"],
      },
      borderRadius: {
        duo: "16px",
      },
      transitionTimingFunction: {
        duo: "cubic-bezier(0.16, 1, 0.3, 1)",
        float: "cubic-bezier(0.45, 0.05, 0.55, 0.95)",
      },
    },
  },
} satisfies Config;

export default config;
