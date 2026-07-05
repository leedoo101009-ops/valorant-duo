import Navbar from "./components/Navbar";
import HeroSection from "./components/HeroSection";
import ShowcaseCards from "./components/ShowcaseCards";
import FlowSection from "./components/FlowSection";
import DashboardPreview from "./components/DashboardPreview";
import StatsBar from "./components/StatsBar";
import CTASection from "./components/CTASection";
import Footer from "./components/Footer";
import SupabaseStatus from "./components/SupabaseStatus";

export default function Home() {
  return (
    <>
      <Navbar />
      <main>
        <HeroSection />
        <ShowcaseCards />
        <FlowSection />
        <DashboardPreview />
        <StatsBar />
        <CTASection />
      </main>
      <Footer />
      <SupabaseStatus />
    </>
  );
}
