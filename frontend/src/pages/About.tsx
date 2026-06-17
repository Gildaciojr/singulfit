// src/pages/About.tsx

export default function About() {
  return (
    <div className="min-h-screen bg-background text-foreground py-22 px-6">
      <div className="max-w-4xl mx-auto space-y-10">

        <div className="space-y-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Sobre a LucyFit
          </h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Tecnologia de ponta para transformar a maneira como as pessoas 
            cuidam da alimentação e da saúde no dia a dia.
          </p>
        </div>

        <div className="space-y-8 text-lg leading-relaxed text-gray-700">
          <p>
            A <strong>LucyFit</strong> nasceu com o propósito de simplificar a vida 
            de quem quer ter mais controle sobre sua alimentação sem precisar 
            perder tempo com planilhas, cálculos ou aplicativos complicados.
          </p>

          <p>
            Utilizando Inteligência Artificial avançada, nossa plataforma analisa 
            refeições por foto, áudio ou texto, gera relatórios completos, oferece 
            insights instantâneos e acompanha sua evolução — tudo diretamente pelo WhatsApp.
          </p>

          <p>
            Nosso objetivo é proporcionar uma experiência simples, intuitiva e 
            altamente precisa, ajudando milhares de pessoas a criar hábitos mais saudáveis 
            e alcançar seus objetivos com autonomia.
          </p>

          <p>
            Hoje, já são <strong>mais de 50 mil usuários</strong> utilizando a LucyFit diariamente. 
            Estamos em constante evolução, sempre ouvindo nossa comunidade e trazendo 
            melhorias constantes para oferecer a melhor experiência possível.
          </p>

          <p className="mt-6 font-semibold">
            Obrigado por fazer parte da nossa jornada 🚀  
          </p>
        </div>

      </div>
    </div>
  );
}
