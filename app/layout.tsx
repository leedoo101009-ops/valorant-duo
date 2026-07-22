import type { Metadata } from "next";
import Providers from "./components/Providers";
import {
  Bricolage_Grotesque,
  Inter,
  JetBrains_Mono,
  Noto_Sans_KR,
} from "next/font/google";
import "./globals.css";

// 헤드라인 영문 — Bricolage Grotesque (스펙)
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

// 본문 영문 — Inter
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

// 한글 — Bricolage/Inter에 한글 글리프 없음 → Noto fallback
const notoSansKR = Noto_Sans_KR({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
      className={`${bricolage.variable} ${inter.variable} ${notoSansKR.variable} ${jetbrains.variable} h-full scroll-smooth antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#05080b] font-body text-white">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
