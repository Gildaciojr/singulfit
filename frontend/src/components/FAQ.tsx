"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { FAQItem } from "@/engine/landing.types";
import { motion } from "framer-motion";
import { HelpCircle } from "lucide-react";
import { useState } from "react";

type Props = {
  data: FAQItem[];
};

export default function FAQ({ data }: Props) {
  const [activeItem, setActiveItem] = useState<string | null>(
    data.length ? "faq-0" : null,
  );

  return (
    <section id="faq" className="relative overflow-hidden py-14 lg:py-20">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(800px_500px_at_50%_0%,rgba(34,120,84,0.08),transparent_70%)]" />

      <div className="absolute inset-0 -z-10 opacity-[0.03] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container mx-auto max-w-6xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
          className="mx-auto mb-20 max-w-4xl text-center"
        >
          <div
            className="
              inline-flex
              items-center
              gap-2
              rounded-full
              border
              border-zinc-200
              bg-white/80
              px-5
              py-2
              text-[11px]
              font-bold
              uppercase
              tracking-[0.22em]
              text-zinc-700
              backdrop-blur-xl
            "
          >
            <HelpCircle className="h-4 w-4" />
            Dúvidas frequentes
          </div>

          <h2
            className="
              mt-7
              text-5xl
              font-black
              tracking-[-0.06em]
              text-zinc-950
              md:text-7xl
            "
          >
            Tudo o que você precisa saber.
          </h2>

          <p
            className="
              mx-auto
              mt-7
              max-w-3xl
              text-lg
              leading-9
              text-zinc-600
            "
          >
            Respostas rápidas, objetivas e transparentes para que você possa
            começar sua evolução com total confiança.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45 }}
          className="mx-auto max-w-4xl"
        >
          <Accordion
            type="single"
            collapsible
            value={activeItem ?? undefined}
            onValueChange={(value) => setActiveItem(value || null)}
          >
            {data.map((faq, index) => {
              const value = `faq-${index}`;
              const isActive = activeItem === value;

              return (
                <AccordionItem
                  key={index}
                  value={value}
                  className={`
    group
    mb-4
    overflow-hidden
    rounded-[1.75rem]
    border
    transition-all
    duration-300
    ${
      isActive
        ? `
          border-emerald-200
          bg-gradient-to-br
          from-white
          to-emerald-50/60
          shadow-[0_20px_50px_-30px_rgba(6,78,59,0.22)]
        `
        : `
          border-zinc-200
          bg-white/80
          hover:border-emerald-200
          hover:bg-white
        `
    }
  `}
                >
                  <AccordionTrigger
                    className="
                      px-7
                      py-7
                      text-left
                      hover:no-underline
                    "
                  >
                    <div className="flex w-full items-center justify-between gap-8">
                      <span
                        className={`
                          text-[1.12rem]
                          font-bold
                          tracking-[-0.03em]
                          leading-relaxed
                          tracking-[-0.02em]
                          transition-colors
                          duration-300
                          ${isActive ? "text-zinc-950" : "text-zinc-800"}
                        `}
                      >
                        {faq.question}
                      </span>

                      <motion.div
                        animate={{
                          rotate: isActive ? 45 : 0,
                        }}
                        transition={{ duration: 0.25 }}
                        className={`
                          shrink-0
                          flex
                          h-11
                          w-11
                          items-center
                          justify-center
                          rounded-full
                          border
                          bg-white
                          shadow-sm
                          transition-colors
                          duration-300
                          ${isActive ? "text-emerald-700" : "text-zinc-400"}
                        `}
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <path
                            d="M12 5V19M5 12H19"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          />
                        </svg>
                      </motion.div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent>
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      className="
  mx-7
  mb-7
  rounded-2xl
  border
  border-emerald-100
  bg-white/80
  px-6
  py-5
  text-[15px]
  leading-8
  text-zinc-600
"
                    >
                      {faq.answer}
                    </motion.div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </motion.div>
      </div>
    </section>
  );
}
