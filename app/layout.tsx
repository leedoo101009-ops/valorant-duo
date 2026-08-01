import type { Metadata } from "next";
import Providers from "./components/Providers";
import {
  Inter,
  JetBrains_Mono,
  Noto_Sans_KR,
} from "next/font/google";
import "./globals.css";

// 본문 + 헤드라인 영문 — Inter (또렷하고 무게 400~900 지원)
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
});

// 한글 — Inter에 한글 글리프 없음 → Noto fallback
const notoSansKR = Noto_Sans_KR({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Duorant — Real-Time Valorant Duo Matching",
  description:
    "AI-powered playstyle analysis and real-time duo matching for Valorant players.",
  keywords: ["발로란트", "듀오", "매칭", "AI", "e스포츠", "Duorant"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${inter.variable} ${notoSansKR.variable} ${jetbrains.variable} h-full scroll-smooth antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#05080b] font-body text-white">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
