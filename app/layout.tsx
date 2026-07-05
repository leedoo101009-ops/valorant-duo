import type { Metadata } from "next";
import Providers from "./components/Providers";
import { Noto_Sans_KR, Rajdhani } from "next/font/google";
import "./globals.css";

const notoSansKR = Noto_Sans_KR({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "DUO — Real-Time Valorant Duo Matching",
  description:
    "AI-powered playstyle analysis and real-time duo matching for Valorant players.",
  keywords: ["발로란트", "듀오", "매칭", "AI", "e스포츠", "FACEIT"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${notoSansKR.variable} ${rajdhani.variable} h-full scroll-smooth antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-white">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
