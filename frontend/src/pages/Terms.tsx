// src/pages/Terms.tsx
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { landingData } from "@/data/default-landing";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Header data={landingData.header} />

      <main className="container mx-auto px-6 py-20 max-w-4xl">

        <header className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            ⚖️ Termos de Uso – SingulFit
          </h1>
          <p className="text-muted-foreground mt-4">
            Última atualização: 14 de novembro de 2025
          </p>
        </header>

        <section className="space-y-12 text-lg leading-relaxed text-foreground/90">

          {/* 1 */}
          <article>
            <h2 className="text-2xl font-bold mb-4">1. Introdução</h2>
            <p>
              Ao utilizar a SingulFit, você concorda automaticamente com estes
              Termos de Uso, que regem o acesso e utilização da plataforma no
              WhatsApp, no site e no checkout web.
            </p>
          </article>

          {/* 2 */}
          <article>
            <h2 className="text-2xl font-bold mb-4">2. Definições</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>SingulFit:</strong> Assistente de IA focada em nutrição e bem-estar.</li>
              <li><strong>Usuário:</strong> Qualquer pessoa que utiliza nossos serviços.</li>
              <li><strong>Serviços:</strong> Registro alimentar, IA e recomendações nutricionais.</li>
              <li><strong>Conta:</strong> Perfil vinculado ao número do WhatsApp.</li>
            </ul>
          </article>

          {/* 3 */}
          <article>
            <h2 className="text-2xl font-bold mb-4">3. Cadastro e Acesso</h2>
            <p>Para utilizar o serviço, o usuário deve:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Fornecer um número válido de WhatsApp;</li>
              <li>Ser maior de 18 anos;</li>
              <li>Oferecer dados verídicos ao interagir com a IA.</li>
            </ul>
          </article>

          {/* 4 */}
          <article>
            <h2 className="text-2xl font-bold mb-4">4. Funcionalidades</h2>
            <p>A SingulFit oferece recursos como:</p>
            <ul className="list-disc pl-6 space-y-2 mt-2">
              <li>Análise nutricional de refeições;</li>
              <li>Recomendações automáticas;</li>
              <li>Ativação e atendimento pelo WhatsApp cadastrado;</li>
              <li>Gestão do status de assinatura pelo checkout;</li>
            </ul>
          </article>

          {/* 5 */}
          <article>
            <h2 className="text-2xl font-bold mb-4">5. Planos e Assinaturas</h2>
            <p>
              Assinaturas são processadas pelo PagBank. Solicitações de
              cancelamento devem ser feitas pelos canais oficiais de atendimento
              da SingulFit.
            </p>
          </article>

          {/* 6 */}
          <article>
            <h2 className="text-2xl font-bold mb-4">6. Direitos e Obrigações</h2>

            <h3 className="text-xl font-semibold mb-2 mt-4">Usuário</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Usar a plataforma de forma ética;</li>
              <li>Manter seus dados atualizados;</li>
              <li>Proteger seu dispositivo de acessos indevidos.</li>
            </ul>

            <h3 className="text-xl font-semibold mb-2 mt-6">SingulFit</h3>
            <ul className="list-disc pl-6 space-y-2">
              <li>Proteger dados e comunicações;</li>
              <li>Garantir a disponibilidade do serviço;</li>
              <li>Oferecer suporte quando necessário.</li>
            </ul>
          </article>

          {/* 7 */}
          <article>
            <h2 className="text-2xl font-bold mb-4">7. Limitações de Responsabilidade</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Instabilidades causadas por terceiros (WhatsApp, operadoras);</li>
              <li>Interpretações incorretas por informações incompletas;</li>
              <li>Acompanhamento físico não substitui profissionais de saúde.</li>
            </ul>
          </article>

          {/* 8 */}
          <article>
            <h2 className="text-2xl font-bold mb-4">8. Atualizações dos Termos</h2>
            <p>
              Os Termos podem ser atualizados periodicamente. A continuidade do
              uso implica concordância automática.
            </p>
          </article>

          {/* 9 */}
          <article>
            <h2 className="text-2xl font-bold mb-4">9. Foro</h2>
            <p>
              Elegemos o foro da Comarca de São Bernardo do Campo – SP para
              resolução de eventuais conflitos.
            </p>
          </article>

        </section>
      </main>

      <Footer />
    </div>
  );
}
