import { ArrowRight, CheckCircle2, MessageCircle } from "lucide-react";

const experienceHighlights = [
  {
    title: "Personalização",
    description: "Orientações que consideram seus hábitos e objetivos.",
  },
  {
    title: "Praticidade",
    description: "Acompanhamento direto no WhatsApp, onde sua rotina acontece.",
  },
  {
    title: "Constância",
    description: "Mais clareza para fazer escolhas e acompanhar sua evolução.",
  },
];

export default function Guarantee() {
  return (
    <section
      id="guarantee"
      aria-labelledby="experience-title"
      className="bg-[#f8f7f3] py-12 sm:py-16"
    >
      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div className="grid min-w-0 items-center gap-6 rounded-2xl border border-emerald-100 bg-white p-5 sm:p-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-10">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <MessageCircle aria-hidden="true" className="h-4 w-4" /> Conheça a
              experiência SingulFit
            </span>
            <h2
              id="experience-title"
              className="mt-3 max-w-xl text-3xl font-black leading-tight tracking-[-0.04em] text-zinc-950 sm:text-4xl"
            >
              Nutrição inteligente{" "}
              <span className="text-emerald-800">para a vida real.</span>
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-600">
              Uma nova forma de cuidar da alimentação: personalizada, prática e
              conectada ao seu dia a dia pelo WhatsApp.
            </p>
            <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600">
              Sua rotina, seu ritmo. Tecnologia para simplificar suas escolhas e
              apoiar uma evolução com mais constância.
            </p>
            <a
              href="#pricing"
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-900 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-emerald-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
            >
              Encontrar meu plano{" "}
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </a>
          </div>
          <div className="min-w-0 rounded-xl bg-emerald-50/70 p-4 sm:p-5">
            <h3 className="text-sm font-bold text-emerald-950">
              Sua rotina, seu ritmo, seu acompanhamento
            </h3>
            <ul className="mt-4 space-y-4">
              {experienceHighlights.map((item) => (
                <li key={item.title} className="flex items-start gap-3">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-zinc-950">
                      {item.title}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-zinc-600">
                      {item.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
