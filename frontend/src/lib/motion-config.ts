import { LazyMotion, domAnimation } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";

export { LazyMotion, domAnimation };

export function useMotionConfig() {
  const isMobile = useIsMobile();

  if (isMobile) {
    return {
      initial: false,
      animate: false,
      whileInView: undefined,
      transition: { duration: 0 },
      viewport: undefined,
    };
  }

  return {
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    transition: { duration: 0.6 },
    viewport: { once: true },
  };
}
