import type { Metadata } from "next";
import Footer from "../components/Footer";
import LegalDocument from "../components/LegalDocument";
import Navbar from "../components/Navbar";

export const metadata: Metadata = {
  title: "이용약관 — DUO",
  description: "Valorant Duo Match 이용약관",
};

export default function TermsPage() {
  return (
    <>
      <Navbar />
      <LegalDocument type="terms" />
      <Footer />
    </>
  );
}
