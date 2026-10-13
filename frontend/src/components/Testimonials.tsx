import { TestimonialsData } from "@/engine/landing.types";
import {
  ArrowRight,
  MessageCircle,
  Quote,
  Sparkles,
  TrendingUp,
} from "lucide-react";

type Props = { data: TestimonialsData };

const experienceItems = [
  {
    title: "Acompanhamento próximo",
    description: "Orientações personalizadas direto no WhatsApp.",
    icon: MessageCircle,
  },
  {
    title: "Nutrição para a vida real",
    description: "Uma experiência pensada para seus hábitos e sua rotina.",
    icon: Sparkles,
  },
  {
    title: "Constância no seu ritmo",
    description: "Mais clareza para cuidar da alimentação no dia a dia.",
    icon: TrendingUp,
  },
];

export default function Testimonials({ data }: Props) {
  return (
    <section
      id="testimonials"
      aria-labelledby="testimonials-title"
      className="relative isolate bg-[#f8faf8] py-12 sm:py-16 lg:py-20"
    >
      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-10">
          <aside className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900">
              <MessageCircle aria-hidden="true" className="h-4 w-4" />
              Depoimentos
            </span>
            <h2
              id="testimonials-title"
              className="mt-4 max-w-md text-3xl font-black leading-tight tracking-[-0.04em] text-zinc-950 sm:text-4xl"
            >
              Rotinas diferentes.
              <span className="block text-emerald-800">
                Evolução mais simples.
              </span>
            </h2>
            <p className="mt-4 max-w-md text-base leading-7 text-zinc-600">
              Conheça as experiências de quem encontrou na SingulFit uma forma
              mais prática de cuidar da alimentação e manter constância.
            </p>
            <ul className="mt-6 space-y-4">
              {experienceItems.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.title} className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100/70 text-emerald-800">
                      <Icon aria-hidden="true" className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold leading-5 text-zinc-950">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-zinc-600">
                        {item.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 border-l-2 border-emerald-700 pl-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Filosofia SingulFit
              </h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-700">
                Tecnologia que simplifica. Acompanhamento que se aproxima. Uma
                evolução que cabe na sua rotina.
              </p>
            </div>
          </aside>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {data.comments.map((item, index) => {
              const initials = item.name
                .split(" ")
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part.charAt(0).toUpperCase())
                .join("");
              return (
                <article
                  key={`${item.name}-${index}`}
                  className={`flex min-w-0 flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_8px_24px_-18px_rgba(6,78,59,0.18)] sm:p-5 ${index === data.comments.length - 1 && data.comments.length % 2 !== 0 ? "sm:col-span-2 sm:w-[calc(50%-0.5rem)] sm:justify-self-center" : ""}`}
                >
                  <Quote
                    aria-hidden="true"
                    className="h-5 w-5 text-emerald-700"
                  />
                  <blockquote className="mt-3 text-sm leading-6 text-zinc-700">
                    “{item.quote}”
                  </blockquote>
                  <div className="mt-auto pt-4">
                    <div className="flex items-center gap-3 border-t border-zinc-100 pt-4">
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-900"
                      >
                        {initials || "SF"}
                      </span>
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold text-zinc-950">
                          {item.name}
                        </p>
                        <p className="mt-0.5 break-words text-sm leading-5 text-zinc-600">
                          {item.role}
                        </p>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
        <div className="mt-8 flex flex-col items-start gap-5 rounded-2xl bg-emerald-950 p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h3 className="text-xl font-bold tracking-tight text-white">
              Sua evolução pode ser mais leve, prática e inteligente.
            </h3>
            <p className="mt-2 text-sm leading-6 text-emerald-100">
              Nutrição inteligente e acompanhamento no WhatsApp, no seu dia a
              dia.
            </p>
          </div>
          <a
            href="#pricing"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-emerald-950 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-950"
          >
            Conhecer os planos{" "}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
