"use client";

import { motion } from "framer-motion";

export default function GlobalEffects() {
  return (
    <>
      {/* GLOW PRINCIPAL */}

      <motion.div
        className="
          pointer-events-none
          fixed
          left-1/2
          top-0
          -z-10
          h-[580px]
          w-[580px]
          -translate-x-1/2
          rounded-full
          bg-emerald-700/6
          blur-[160px]
        "
        animate={{
          scale: [1, 1.08, 1],
          opacity: [0.5, 0.8, 0.5],
        }}
        transition={{
          duration: 22,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* GLOW SECUNDÁRIO */}

      <motion.div
        className="
          pointer-events-none
          fixed
          right-[-120px]
          top-[20%]
          -z-10
          h-[320px]
          w-[320px]
          rounded-full
          bg-emerald-500/4
          blur-[120px]
        "
        animate={{
          y: [0, 18, 0],
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{
          duration: 24,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      <motion.div
        className="
    pointer-events-none
    fixed
    left-[-120px]
    bottom-[10%]
    -z-10
    h-[300px]
    w-[300px]
    rounded-full
    bg-emerald-400/4
    blur-[120px]
  "
        animate={{
          y: [0, -15, 0],
          opacity: [0.2, 0.45, 0.2],
        }}
        transition={{
          duration: 26,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      />

      {/* VIGNETTE SUAVE */}

      <div
        className="
          pointer-events-none
          fixed
          inset-0
          -z-20
          bg-[radial-gradient(circle_at_center,transparent_55%,rgba(15,23,42,0.025)_100%)]
        "
      />
    </>
  );
}
