// ================= BASE TYPES =================

export interface CTA {
  label: string;
  link: string;
}

export interface Metric {
  value: string;
  label: string;
}

// ================= HERO =================

export interface HeroData {
  badge: string;
  title: string;
  subtitle: string;
  cta: CTA;
  metrics: Metric[];
}

export interface HeaderLink {
  label: string;
  target: string;
}

export interface HeaderData {
  logo: string;
  links: HeaderLink[];
  cta: {
    label: string;
    target: string;
  };
}

// ================= FEATURES =================

export interface FeatureItem {
  id: number;
  title: string;
  text: string;
  media: string;
}

// ================= PRICING =================

export interface PricingFeature {
  name: string;
  included: boolean;
}

export interface PricingCTA {
  text: string;
  href?: string;
  onClick?: () => void;
}

export interface PricingPlan {
  name: string;
  price: number;
  interval: string;
  description: string;
  features: PricingFeature[];
  cta: PricingCTA;
}

// ================= TESTIMONIALS (ENGINE) =================

export interface TestimonialVideo {
  src: string;
  poster: string;
  person: {
    name: string;
    age: number;
  };
}

export interface TestimonialComment {
  quote: string;
  name: string;
  role: string;
}

export interface TestimonialsData {
  videos: TestimonialVideo[];
  comments: TestimonialComment[];
}

// ================= FAQ =================

export interface FAQItem {
  question: string;
  answer: string;
}

// ================= LANDING ROOT =================

export interface LandingData {
  hero: HeroData;
  features: FeatureItem[];

  pricing: {
    monthly: PricingPlan;
    annual: PricingPlan;
  };

  testimonials: TestimonialsData; // ✅ CORRETO AGORA
  faq?: FAQItem[];
  moreFeatures: MoreFeaturesData;
  header: HeaderData;
}

export interface MoreFeatureItem {
  icon: string; // nome do ícone (ex: "Calendar")
  title: string;
  description: string;
}

export interface MoreFeaturesData {
  title: string;
  subtitle?: string;
  items: MoreFeatureItem[];
}

export interface IntegrationItem {
  name: string;
}

export interface IntegrationData {
  title: string;
  subtitle: string;
  items: IntegrationItem[];
}
