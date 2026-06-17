// src/pages/Index.tsx

import Hero from "@/components/Hero";
import Header from "@/components/Header";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import Guarantee from "@/components/Guarantee";
import MoreFeatures from "@/components/MoreFeatures";
import Testimonials from "@/components/Testimonials";
import Pricing from "@/components/Pricing";
import FAQ from "@/components/FAQ";
import Footer from "@/components/Footer";
import StickyCTA from "@/components/StickyCTA";

import { landingData } from "@/data/default-landing";

export default function Index() {
  return (
    <main className="main-bg overflow-x-hidden text-foreground">
      <Header data={landingData.header} />

      {/* HERO */}
      <Hero data={landingData.hero} />

      {/* DEMONSTRAÇÃO VISUAL */}
      <HowItWorks />

      {/* FUNCIONALIDADES AVANÇADAS */}
      <MoreFeatures data={landingData.moreFeatures} />

      {/* PROVA SOCIAL */}
      <Testimonials data={landingData.testimonials} />

      {/* GARANTIA */}
      <Guarantee />

      {/* PLANOS */}
      <Pricing data={landingData.pricing} />

      {/* FAQ */}
      <FAQ data={landingData.faq ?? []} />

      {/* CTA FINAL */}
      <Footer />

      {/* CTA FIXO MOBILE/DESKTOP */}
      <StickyCTA />
    </main>
  );
}
