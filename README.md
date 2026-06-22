# SingulFit

Landing e checkout comercial da SingulFit: um fluxo WhatsApp-first para cadastro, escolha de plano, pagamento via PIX e ativação automática.

## Stack

- React 18 + TypeScript + Vite
- TailwindCSS + shadcn/ui + Radix UI
- React Query
- Backend NestJS + Prisma + PostgreSQL
- PagBank para PIX
- Evolution API para WhatsApp
- OpenAI para análise nutricional

## Fluxo Comercial

Landing -> Plano -> Cadastro -> PIX -> Aguardando pagamento -> Pagamento aprovado -> Boas-vindas no WhatsApp.

O frontend consome os endpoints do backend:

- `POST /api/v1/auth/register`
- `POST /api/v1/payments/pix`
- `GET /api/v1/checkout/status`
- `POST /api/v1/auth/refresh`

## Frontend

```bash
cd frontend
npm install
npm run dev
npm run build
npm run lint
```

Ambiente local usa `http://localhost:3000/api/v1` por padrão.

Para staging/produção, configure explicitamente:

```env
VITE_API_BASE_URL=https://api.singulfit.com.br/api/v1
```

## Backend

```bash
cd backend
npm install
npx prisma validate
npm run build
npm run lint
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

O backend exige variáveis reais para banco, JWT, PagBank, Evolution, OpenAI, storage, CORS e workers. Use `backend/.env.example` como base e nunca versione `.env` reais.

## Deploy Staging

Antes do primeiro deploy real:

- consolidar e revisar o commit de release;
- configurar `VITE_API_BASE_URL` no frontend;
- configurar `.env.production` do backend fora do Git;
- aplicar migrations com `prisma migrate deploy`;
- subir API e workers;
- configurar DNS, TLS, CORS e webhooks PagBank/Evolution;
- executar healthchecks e smoke test.

## Observações

- O checkout é próprio da SingulFit.
- O pagamento PIX é processado pelo PagBank.
- A experiência pós-pagamento acontece pelo WhatsApp informado no cadastro.
