# 🌟 LucyFit — Landing Page Oficial

Landing page moderna, responsiva e otimizada da **LucyFit**, desenvolvida com foco em **alta conversão mobile**, performance e design premium.

Projeto construído em **React + TypeScript + Vite**, utilizando **TailwindCSS**, **shadcn/ui** e **framer-motion**, seguindo padrões profissionais de SaaS e infoprodutos.

---

## 🚀 Tecnologias Utilizadas

- **React 18**
- **TypeScript**
- **Vite**
- **TailwindCSS**
- **shadcn/ui**
- **Radix UI**
- **framer-motion**
- **Lucide Icons**
- **Hotmart Checkout**
- **Meta Pixel (Facebook Ads)**

---

## 📂 Estrutura do Projeto

```txt
src/
 ├─ assets/
 │   ├─ gifs/
 │   ├─ images/
 │
 ├─ components/
 │   ├─ Hero.tsx
 │   ├─ Features.tsx
 │   ├─ MoreFeatures.tsx
 │   ├─ Testimonials.tsx
 │   ├─ Pricing.tsx
 │   ├─ FAQ.tsx
 │
 ├─ hooks/
 │   ├─ use-mobile.tsx
 │
 ├─ lib/
 │   ├─ motion-config.ts
 │   ├─ utils.ts
 │
 ├─ main.tsx
 ├─ index.css
💜 Funcionalidades da Landing Page
🎯 Hero Section
Headline principal da LucyFit

CTA direto para planos

Métricas sociais (prova social)

GIF animado otimizado (mobile-first)

Design premium com gradientes suaves

📄 Arquivo:
src/components/Hero.tsx

⚡ Seção “Como a LucyFit te ajuda todos os dias”
Cards informativos

GIFs demonstrativos

Interação otimizada para desktop

Versão mobile estável e sem travamentos

📄 Arquivo:
src/components/Features.tsx

🎨 Seção “Mais Funções”
Grade de recursos

Ícones profissionais

Animações leves (desativadas no mobile para performance)

📄 Arquivo:
src/components/MoreFeatures.tsx

⭐ Depoimentos de Usuários
Carrossel automático

Layout premium

Mais depoimentos visíveis no desktop

Mobile otimizado sem sobrecarga de animações

📄 Arquivo:
src/components/Testimonials.tsx

💰 Seção de Preços
Alternância Mensal / Anual

Plano anual destacado

Selo “Mais Vendido”

Card de Garantia de 7 dias

Integração direta com Hotmart

📄 Arquivo:
src/components/Pricing.tsx

🔗 Links de Checkout (Hotmart)
Plano Mensal
txt
Copiar código
https://pay.hotmart.com/K102603335O?off=oe515n4q&checkoutMode=10&bid=1765197985158
Plano Anual
txt
Copiar código
https://pay.hotmart.com/K102603335O?off=gv3oc04g&checkoutMode=10

📌 Para trocar os links, editar apenas:

ts
Copiar código
cta: {
  text: "...",
  href: "NOVO_LINK_AQUI"
}
❓ FAQ
Accordion animado

Conteúdo 100% editável

Visual limpo e profissional

📄 Arquivo:
src/components/FAQ.tsx

⚙️ Configuração de Performance (Importante)
A landing foi otimizada para mobile-first, pois o acesso será feito na maior parte dos casos pelo smartphone

O que já está otimizado:
GIFs carregados sob demanda

Animações desativadas no mobile

Lazy loading em imagens

Layout estável (sem CLS)

Pontuação alta no Lighthouse Mobile

📄 Arquivo chave:
src/lib/motion-config.ts

⚠️ Não remover essa lógica, pois ela é essencial para performance.

🏗 Rodando o Projeto Localmente
bash
Copiar código
npm install
npm run dev
A aplicação irá rodar em:

txt
Copiar código
http://localhost:5173

🚀 Build de Produção

bash

Copiar código
npm run build

🌐 Deploy (Recomendado)

Vercel

Netlify

Configuração padrão, sem variáveis de ambiente obrigatórias.

✏️ Como Fazer Alterações com Segurança
Alterar textos
➡️ Editar diretamente nos componentes (Hero.tsx, Features.tsx, etc.)

Alterar imagens ou GIFs
➡️ Substituir arquivos em:

txt
Copiar código
src/assets/gifs/
src/assets/images/
⚠️ Manter o mesmo nome do arquivo evita retrabalho.

🔒 Boas Práticas
Não remover hooks de performance

Não reativar animações no mobile

Sempre testar no celular

Comprimir GIFs antes de subir



👨‍💻 Desenvolvido por Gildácio Júnior

Landing criada com foco em conversão, performance e experiência do usuário.

