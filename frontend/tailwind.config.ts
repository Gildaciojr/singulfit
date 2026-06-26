import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        charcoal: "hsl(var(--charcoal))",
        graphite: "hsl(var(--graphite))",
        "soft-gray": "hsl(var(--soft-gray))",
        "purple-deep": "hsl(var(--purple-deep))",
        "lilac-soft": "hsl(var(--lilac-soft))",
        "gold-elegant": "hsl(var(--gold-elegant))",
        success: "hsl(var(--success))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        "sf-sm": "var(--sf-radius-sm)",
        "sf-md": "var(--sf-radius-md)",
        "sf-lg": "var(--sf-radius-lg)",
        "sf-xl": "var(--sf-radius-xl)",
      },
      spacing: {
        "sf-2xs": "var(--sf-space-2xs)",
        "sf-xs": "var(--sf-space-xs)",
        "sf-sm": "var(--sf-space-sm)",
        "sf-md": "var(--sf-space-md)",
        "sf-lg": "var(--sf-space-lg)",
        "sf-xl": "var(--sf-space-xl)",
        "sf-2xl": "var(--sf-space-2xl)",
      },
      fontSize: {
        "sf-xs": ["var(--sf-text-xs)", { lineHeight: "1.4" }],
        "sf-sm": ["var(--sf-text-sm)", { lineHeight: "1.45" }],
        "sf-base": ["var(--sf-text-base)", { lineHeight: "1.55" }],
        "sf-lg": ["var(--sf-text-lg)", { lineHeight: "1.55" }],
        "sf-xl": ["var(--sf-text-xl)", { lineHeight: "1.2" }],
        "sf-2xl": ["var(--sf-text-2xl)", { lineHeight: "1.15" }],
        "sf-3xl": ["var(--sf-text-3xl)", { lineHeight: "1.08" }],
        "sf-4xl": ["var(--sf-text-4xl)", { lineHeight: "1" }],
      },
      maxWidth: {
        "sf-container": "var(--sf-container-max)",
      },
      minHeight: {
        "sf-screen": "var(--sf-viewport-height)",
        "sf-small-screen": "var(--sf-viewport-small-height)",
        "sf-large-screen": "var(--sf-viewport-large-height)",
      },
      height: {
        "sf-screen": "var(--sf-viewport-height)",
        "sf-small-screen": "var(--sf-viewport-small-height)",
        "sf-large-screen": "var(--sf-viewport-large-height)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(30px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-20px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.6s ease-out",
        "fade-in-up": "fade-in-up 0.8s ease-out",
        "scale-in": "scale-in 0.5s ease-out",
        float: "float 3s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
