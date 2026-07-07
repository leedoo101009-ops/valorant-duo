import Footer from "../components/Footer";
import LegalDocument from "../components/LegalDocument";
import Navbar from "../components/Navbar";

export default function TermsPage() {
  return (
    <>
      <Navbar />
      <LegalDocument type="terms" />
      <Footer />
    </>
  );
}
