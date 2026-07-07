import type { Metadata } from "next";
import Footer from "../components/Footer";
import LegalDocument from "../components/LegalDocument";
import Navbar from "../components/Navbar";

export const metadata: Metadata = {
  title: "개인정보처리방침 — DUO",
  description: "Valorant Duo Match 개인정보처리방침",
};

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      <LegalDocument type="privacy" />
      <Footer />
    </>
  );
}
