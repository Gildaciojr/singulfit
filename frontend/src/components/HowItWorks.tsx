import {
  Camera,
  CheckCircle2,
  MessageCircle,
  Sparkles,
  TrendingUp,
} from "lucide-react";

const steps = [
  {
    number: "01",
    title: "Envie uma foto",
    description:
      "Basta enviar uma foto da refeição pelo WhatsApp. Sem aplicativos, sem formulários e sem complicação.",
    icon: Camera,
  },
  {
    number: "02",
    title: "Receba uma análise inteligente",
    description:
      "A IA ajuda a identificar alimentos, estimar calorias e macronutrientes e compreender o contexto da refeição.",
    icon: Sparkles,
  },
  {
    number: "03",
    title: "Evolua continuamente",
    description:
      "Cada refeição ajuda a IA a entender melhor seus hábitos e entregar orientações mais inteligentes.",
    icon: TrendingUp,
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="bg-[#f8f7f3] py-12 sm:py-16"
    >
      <div className="mx-auto w-full max-w-[1160px] px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900">
            <Sparkles aria-hidden="true" className="h-4 w-4" /> Como funciona
          </span>
          <h2
            id="how-it-works-title"
            className="mt-4 text-[clamp(1.875rem,3.4vw,2.75rem)] font-black leading-[1.12] tracking-[-0.04em] text-zinc-950"
          >
            Três passos.{" "}
            <span className="text-emerald-800">Nenhuma complicação.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-base leading-7 text-zinc-600">
            Uma experiência construída para funcionar como uma conversa natural.
            Você envia. A IA entende. Você evolui.
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Demonstração ilustrativa. Os valores nutricionais abaixo são
            estimativas de exemplo.
          </p>
        </div>
        <ol className="mt-7 space-y-3 sm:space-y-4">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.number}
                data-cta-protected
                className="grid min-w-0 items-center gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-[0_8px_24px_-20px_rgba(6,78,59,0.16)] sm:p-5 md:grid-cols-2 md:gap-6"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    aria-label={`Passo ${step.number}`}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-xs font-bold text-emerald-900"
                  >
                    {step.number}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-start gap-2">
                      <Icon
                        aria-hidden="true"
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700"
                      />
                      <h3 className="text-base font-bold leading-6 tracking-tight text-zinc-950">
                        {step.title}
                      </h3>
                    </div>
                    <p className="mt-2 max-w-lg text-sm leading-6 text-zinc-600">
                      {step.description}
                    </p>
                  </div>
                </div>
                <div
                  aria-label={`Exemplo ilustrativo do passo ${step.number}`}
                  className="min-w-0 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 sm:p-4"
                >
                  <p className="mb-2 text-xs font-medium text-emerald-800">
                    Exemplo ilustrativo · {step.number}
                  </p>
                  {index === 0 ? (
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-800">
                        <Camera aria-hidden="true" className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm text-zinc-600">Foto recebida</p>
                        <p className="mt-0.5 text-sm font-bold text-zinc-950">
                          Processando refeição
                        </p>
                      </div>
                      <span
                        aria-hidden="true"
                        className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-600"
                      />
                    </div>
                  ) : index === 1 ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                          <CheckCircle2
                            aria-hidden="true"
                            className="h-4 w-4"
                          />{" "}
                          Análise concluída
                        </p>
                        <p className="text-xl font-bold tracking-tight text-zinc-950">
                          520{" "}
                          <span className="text-sm font-medium text-zinc-600">
                            kcal
                          </span>
                        </p>
                      </div>
                      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-emerald-100 pt-3">
                        {[
                          { label: "Proteína", value: "42 g" },
                          { label: "Carboidratos", value: "58 g" },
                          { label: "Gorduras", value: "13 g" },
                        ].map((nutrient) => (
                          <div key={nutrient.label} className="min-w-0">
                            <dt className="break-words text-xs leading-5 text-zinc-600">
                              {nutrient.label}
                            </dt>
                            <dd className="text-sm font-bold text-zinc-950">
                              {nutrient.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  ) : (
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-800">
                        <MessageCircle aria-hidden="true" className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-emerald-900">
                          Mensagem do seu coach
                        </p>
                        <p className="mt-1 text-sm leading-6 text-zinc-700">
                          Uma ideia para sua próxima refeição: combine uma fonte
                          de proteína com vegetais.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
