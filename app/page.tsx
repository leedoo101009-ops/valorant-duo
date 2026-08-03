import Navbar from "./components/Navbar";
import HeroSection from "./components/HeroSection";
import MatchQueueSection from "./components/MatchQueueSection";
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
        <StatsBar />
        <MatchQueueSection />
        <ShowcaseCards />
        <FlowSection />
        <DashboardPreview />
        <CTASection />
      </main>
      <Footer />
      <SupabaseStatus />
    </>
  );
}
