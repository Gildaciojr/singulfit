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
    <section id="faq" className="relative overflow-hidden py-24 lg:py-36">
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(800px_500px_at_50%_0%,rgba(34,120,84,0.08),transparent_70%)]" />
      <div className="absolute inset-0 -z-10 opacity-[0.03] bg-[linear-gradient(to_right,#111_1px,transparent_1px),linear-gradient(to_bottom,#111_1px,transparent_1px)] bg-[size:56px_56px]" />

      <div className="container mx-auto max-w-5xl px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.45 }}
          className="mx-auto mb-16 max-w-3xl text-center"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-5 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-900 shadow-sm">
            <HelpCircle className="h-4 w-4" />
            Dúvidas frequentes
          </div>

          <h2 className="mt-6 text-4xl font-black tracking-[-0.04em] text-zinc-950 md:text-6xl">
            Perguntas frequentes
          </h2>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
            Tudo o que você precisa saber antes de começar. Respostas simples,
            claras e objetivas.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.45 }}
          className="rounded-[2rem] border border-zinc-200 bg-white p-3 shadow-[0_25px_70px_-35px_rgba(0,0,0,0.20)]"
        >
          <Accordion
            type="single"
            collapsible
            className="space-y-4"
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
                    relative overflow-hidden rounded-[1.65rem] border px-5 transition-all duration-300 md:px-6
                    ${
                      isActive
                        ? "border-emerald-200 bg-white shadow-[0_22px_60px_-35px_rgba(6,78,59,0.35)]"
                        : "border-zinc-200 bg-white hover:border-emerald-200"
                    }
                  `}
                >
                  <AccordionTrigger
                    className={`
                      relative z-10 py-5 text-left font-semibold transition-colors duration-300 md:py-6
                      ${
                        isActive
                          ? "text-emerald-900"
                          : "text-zinc-950 hover:text-emerald-800"
                      }
                    `}
                  >
                    <div className="flex w-full items-center justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <div
                          className={`
                            mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border text-sm font-black transition-all duration-300
                            ${
                              isActive
                                ? "border-emerald-900 bg-emerald-900 text-white"
                                : "border-zinc-200 bg-zinc-50 text-zinc-500"
                            }
                          `}
                        >
                          {(index + 1).toString().padStart(2, "0")}
                        </div>

                        <span className="pt-1 text-base leading-relaxed">
                          {faq.question}
                        </span>
                      </div>

                      <motion.div
                        animate={{
                          rotate: isActive ? 45 : 0,
                          scale: isActive ? 1.06 : 1,
                        }}
                        transition={{ duration: 0.22 }}
                        className={`
                          flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-lg font-medium transition-all duration-300
                          ${
                            isActive
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : "border-zinc-200 bg-white text-zinc-500"
                          }
                        `}
                      >
                        +
                      </motion.div>
                    </div>
                  </AccordionTrigger>

                  <AccordionContent className="relative z-10 pb-6">
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25 }}
                      className="ml-0 rounded-[1.35rem] border border-zinc-200 bg-zinc-50 px-5 py-5 text-[15px] leading-7 text-zinc-700 md:ml-14"
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
