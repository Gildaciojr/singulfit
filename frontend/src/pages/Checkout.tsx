import { FormEvent, ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import {
  ApiError,
  AuthTokensResponse,
  CHECKOUT_STATUS_LABEL,
  createPixPayment,
  PixPaymentResponse,
  registerCheckout,
  refreshCheckoutSession,
} from "@/lib/api";
import {
  COMMERCIAL_PLAN_LIST,
  CommercialPlan,
  CommercialPlanType,
  checkoutPath,
  commercialPlanFromRouteParam,
  formatPlanPrice,
} from "@/lib/commercial-plans";
import {
  clearCheckoutSession,
  readCheckoutAccessToken,
  readCheckoutRefreshToken,
  saveCheckoutSession,
} from "@/lib/checkout-storage";
import { useCheckoutStatus } from "@/hooks/useCheckoutStatus";
import singulfitLogo from "@/assets/images/singulfit-logo.png";

type RegisterFormState = {
  firstName: string;
  lastName: string;
  phone: string;
  cpf: string;
  email: string;
  password: string;
};

type RegisterFormErrors = Partial<Record<keyof RegisterFormState, string>>;

type CheckoutRouteParams = {
  planType?: string;
};

type PaymentDisplay = {
  qrCode: string | null;
  qrCodeImageUrl: string | null;
  expiresAt: string | null;
};

const initialFormState: RegisterFormState = {
  firstName: "",
  lastName: "",
  phone: "",
  cpf: "",
  email: "",
  password: "",
};

export default function Checkout() {
  const params = useParams<CheckoutRouteParams>();
  const navigate = useNavigate();
  const initialPlan = commercialPlanFromRouteParam(params.planType);
  const [selectedPlan, setSelectedPlan] =
    useState<CommercialPlanType>(initialPlan.type);
  const [form, setForm] = useState<RegisterFormState>(initialFormState);
  const [errors, setErrors] = useState<RegisterFormErrors>({});
  const [accessToken, setAccessToken] = useState<string | null>(() =>
    readCheckoutAccessToken(),
  );
  const [refreshToken, setRefreshToken] = useState<string | null>(() =>
    readCheckoutRefreshToken(),
  );
  const [pixPayment, setPixPayment] = useState<PixPaymentResponse | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [pollingStartedAt, setPollingStartedAt] = useState<number | null>(
    accessToken ? Date.now() : null,
  );

  const plan = useMemo(
    () => commercialPlanFromRouteParam(selectedPlan.toLowerCase()),
    [selectedPlan],
  );
  const checkoutStatus = useCheckoutStatus({
    accessToken,
    refreshToken,
    onSessionExpired: expireCheckoutSession,
    onTokenRefresh: handleTokenRefresh,
    pollingStartedAt,
  });

  const registerMutation = useMutation({
    mutationFn: registerCheckout,
  });
  const pixMutation = useMutation({
    mutationFn: (token: string) =>
      createPixPayment(
        {
          idempotencyKey: createIdempotencyKey(),
        },
        token,
      ),
  });

  const currentStatus = checkoutStatus.data?.checkoutStatus;
  const currentPayment = pixPayment ?? checkoutStatus.data?.payment ?? null;
  const submitting = registerMutation.isPending || pixMutation.isPending;

  function updateField(field: keyof RegisterFormState, value: string): void {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
    setErrors((current) => ({
      ...current,
      [field]: undefined,
    }));
  }

  function selectPlan(nextPlan: CommercialPlanType): void {
    setSelectedPlan(nextPlan);
    navigate(checkoutPath(nextPlan), { replace: true });
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateForm(form);

    if (Object.keys(validation).length > 0) {
      setErrors(validation);
      return;
    }

    try {
      const registerResult = await registerMutation.mutateAsync({
        name: `${form.firstName.trim()} ${form.lastName.trim()}`,
        phone: form.phone,
        cpf: digitsOnly(form.cpf),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        planType: selectedPlan,
      });

      saveCheckoutSession(registerResult.tokens, selectedPlan);
      setAccessToken(registerResult.tokens.accessToken);
      setRefreshToken(registerResult.tokens.refreshToken);
      setSessionExpired(false);
      setPollingStartedAt(Date.now());
      const pix = await pixMutation.mutateAsync(
        registerResult.tokens.accessToken,
      );
      setPixPayment(pix);
      toast({
        title: "PIX gerado",
        description: "Agora é só pagar e aguardar a ativação automática.",
      });
    } catch (error: unknown) {
      toast({
        title: "Não foi possível continuar",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  }

  async function retryPix() {
    if (!accessToken && !refreshToken) {
      expireCheckoutSession();
      return;
    }

    try {
      const pix = await createPixWithSessionRefresh();

      setPixPayment(pix);
      setPollingStartedAt(Date.now());
    } catch (error: unknown) {
      toast({
        title: "Não foi possível gerar um novo PIX",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  }

  function handleTokenRefresh(tokens: AuthTokensResponse): void {
    saveCheckoutSession(tokens, selectedPlan);
    setAccessToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);
    setSessionExpired(false);
  }

  function expireCheckoutSession(): void {
    clearCheckoutSession();
    setAccessToken(null);
    setRefreshToken(null);
    setPollingStartedAt(null);
    setSessionExpired(true);
  }

  async function createPixWithSessionRefresh(): Promise<PixPaymentResponse> {
    if (accessToken) {
      try {
        return await pixMutation.mutateAsync(accessToken);
      } catch (error: unknown) {
        if (!(error instanceof ApiError) || error.statusCode !== 401) {
          throw error;
        }
      }
    }

    if (!refreshToken) {
      expireCheckoutSession();
      throw new ApiError("Sessão de checkout expirada.", 401);
    }

    const refreshed = await refreshCheckoutSession(refreshToken);

    handleTokenRefresh(refreshed.tokens);

    return pixMutation.mutateAsync(refreshed.tokens.accessToken);
  }

  async function copyPixCode(code: string | null | undefined) {
    if (!code) {
      return;
    }

    await navigator.clipboard.writeText(code);
    toast({
      title: "Código PIX copiado",
      description: "Cole no app do seu banco para concluir o pagamento.",
    });
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f8f7f3] text-zinc-950">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(900px_520px_at_50%_0%,rgba(34,120,84,0.13),transparent_70%)]" />

      <div className="container mx-auto max-w-6xl px-6 py-8 lg:py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-900 hover:text-emerald-950"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para a landing
        </Link>

        <section className="mt-8 grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <PlanSummary plan={plan} onSelectPlan={selectPlan} />

          {!accessToken && sessionExpired ? (
            <SessionExpiredCard onRestart={() => setSessionExpired(false)} />
          ) : !accessToken ? (
            <RegisterCard
              errors={errors}
              form={form}
              onChange={updateField}
              onSubmit={submitRegister}
              plan={plan}
              submitting={submitting}
            />
          ) : currentStatus === "ACTIVE" ? (
            <ApprovedCard />
          ) : currentStatus === "PAYMENT_EXPIRED" ? (
            <ExpiredCard onRetry={retryPix} retrying={pixMutation.isPending} />
          ) : currentStatus === "PAYMENT_FAILED" ? (
            <RejectedCard />
          ) : (
            <PixCard
              payment={currentPayment}
              statusLabel={
                currentStatus
                  ? CHECKOUT_STATUS_LABEL[currentStatus]
                  : "Gerando PIX"
              }
              loadingPix={pixMutation.isPending}
              polling={checkoutStatus.isFetching}
              onCopy={copyPixCode}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function PlanSummary({
  plan,
  onSelectPlan,
}: {
  plan: CommercialPlan;
  onSelectPlan: (plan: CommercialPlanType) => void;
}) {
  return (
    <div className="lg:sticky lg:top-8">
      <div className="mb-6 flex items-center gap-3">
        <img
          src={singulfitLogo}
          alt="SingulFit"
          className="h-12 w-auto"
        />
        <div>
          <div className="text-2xl font-black tracking-[-0.04em]">
            SingulFit
          </div>
          <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">
            Checkout seguro
          </div>
        </div>
      </div>

      <Card className="overflow-hidden rounded-[2rem] border-zinc-200 bg-white/90 shadow-[0_35px_90px_-45px_rgba(15,23,42,0.25)] backdrop-blur-xl">
        <CardContent className="p-7">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
            <ShieldCheck className="h-4 w-4" />
            Plano selecionado
          </div>

          <h1 className="mt-6 text-4xl font-black tracking-[-0.055em] text-zinc-950">
            {plan.displayName}
          </h1>

          <div className="mt-4 flex items-end gap-2">
            <span className="text-5xl font-black tracking-[-0.06em]">
              {formatPlanPrice(plan.price)}
            </span>
            <span className="pb-2 text-zinc-500">{plan.interval}</span>
          </div>

          <p className="mt-5 text-sm leading-7 text-zinc-600">
            {plan.description}
          </p>

          <div className="mt-6 grid gap-3">
            {plan.features.map((feature) => (
              <div
                key={feature}
                className="flex items-start gap-3 rounded-2xl bg-zinc-50 p-3 text-sm text-zinc-700"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-800" />
                {feature}
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {COMMERCIAL_PLAN_LIST.map((item) => (
              <Button
                key={item.type}
                type="button"
                variant={item.type === plan.type ? "default" : "outline"}
                className="rounded-2xl"
                onClick={() => onSelectPlan(item.type)}
              >
                {item.displayName}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RegisterCard({
  errors,
  form,
  onChange,
  onSubmit,
  plan,
  submitting,
}: {
  errors: RegisterFormErrors;
  form: RegisterFormState;
  onChange: (field: keyof RegisterFormState, value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  plan: CommercialPlan;
  submitting: boolean;
}) {
  return (
    <Card className="rounded-[2rem] border-zinc-200 bg-white shadow-[0_35px_90px_-45px_rgba(15,23,42,0.24)]">
      <CardContent className="p-7 lg:p-9">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
            Cadastro
          </div>
          <h2 className="mt-5 text-3xl font-black tracking-[-0.04em]">
            Crie seu acesso para gerar o PIX.
          </h2>
          <p className="mt-3 text-sm leading-7 text-zinc-600">
            O CPF é obrigatório aqui porque o provedor de pagamento exige esse
            dado para emitir o PIX.
          </p>
        </div>

        <form className="space-y-5" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              error={errors.firstName}
              label="Nome"
              onChange={(value) => onChange("firstName", value)}
              value={form.firstName}
            />
            <FormField
              error={errors.lastName}
              label="Sobrenome"
              onChange={(value) => onChange("lastName", value)}
              value={form.lastName}
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField
              error={errors.phone}
              inputMode="tel"
              label="Telefone com DDD"
              onChange={(value) => onChange("phone", value)}
              placeholder="(11) 99999-9999"
              value={form.phone}
            />
            <FormField
              error={errors.cpf}
              inputMode="numeric"
              label="CPF"
              onChange={(value) => onChange("cpf", value)}
              placeholder="000.000.000-00"
              value={form.cpf}
            />
          </div>

          <FormField
            error={errors.email}
            label="Email"
            onChange={(value) => onChange("email", value)}
            placeholder="voce@email.com"
            type="email"
            value={form.email}
          />

          <FormField
            error={errors.password}
            label="Senha"
            onChange={(value) => onChange("password", value)}
            type="password"
            value={form.password}
          />

          <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
            <Label>Plano</Label>
            <div className="mt-2 text-sm font-bold text-zinc-950">
              {plan.displayName} · {formatPlanPrice(plan.price)}
              {plan.interval}
            </div>
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="h-14 w-full rounded-2xl bg-emerald-900 text-base font-bold text-white hover:bg-emerald-950"
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                Gerar PIX
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function FormField({
  error,
  inputMode,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  error?: string;
  inputMode?: "email" | "numeric" | "tel" | "text";
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "email" | "password" | "text";
  value: string;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
        className="mt-2 h-12 rounded-2xl border-zinc-200 bg-white"
      />
      {error && <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>}
    </div>
  );
}

function PixCard({
  loadingPix,
  onCopy,
  payment,
  polling,
  statusLabel,
}: {
  loadingPix: boolean;
  onCopy: (code: string | null | undefined) => void;
  payment: PixPaymentResponse | PaymentDisplay | null;
  polling: boolean;
  statusLabel: string;
}) {
  const normalized = normalizePayment(payment);

  return (
    <Card className="rounded-[2rem] border-zinc-200 bg-white shadow-[0_35px_90px_-45px_rgba(15,23,42,0.24)]">
      <CardContent className="p-7 lg:p-9">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
          <Clock3 className="h-4 w-4" />
          {statusLabel}
        </div>

        <h2 className="mt-5 text-3xl font-black tracking-[-0.04em]">
          Pague com PIX para ativar seu acesso.
        </h2>
        <p className="mt-3 text-sm leading-7 text-zinc-600">
          Depois do pagamento aprovado, o acesso será ativado automaticamente e
          você receberá a mensagem inicial no WhatsApp cadastrado.
        </p>

        <div className="mt-8 rounded-[1.6rem] border border-zinc-200 bg-zinc-50 p-5">
          {loadingPix && !normalized ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-zinc-600">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-900" />
              Gerando dados do PIX...
            </div>
          ) : (
            <>
              {normalized?.qrCodeImageUrl && (
                <div className="flex justify-center">
                  <img
                    src={normalized.qrCodeImageUrl}
                    alt="QR Code PIX"
                    className="h-64 w-64 rounded-2xl border border-zinc-200 bg-white object-contain p-3"
                  />
                </div>
              )}

              <div className="mt-5">
                <Label>Copia e cola</Label>
                <textarea
                  readOnly
                  value={normalized?.qrCode ?? ""}
                  className="mt-2 min-h-28 w-full rounded-2xl border border-zinc-200 bg-white p-4 text-xs text-zinc-700"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 rounded-2xl"
                  onClick={() => onCopy(normalized?.qrCode)}
                  disabled={!normalized?.qrCode}
                >
                  <Copy className="h-4 w-4" />
                  Copiar código PIX
                </Button>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 rounded-2xl bg-emerald-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-emerald-950">
                Aguardando pagamento
              </div>
              <div className="mt-1 text-xs text-emerald-900/75">
                {normalized?.expiresAt
                  ? `Expira em ${formatDateTime(normalized.expiresAt)}`
                  : "A tela será atualizada automaticamente."}
              </div>
            </div>
            {polling && <RefreshCw className="h-5 w-5 animate-spin text-emerald-900" />}
          </div>
          <Progress value={65} className="mt-4 h-2 bg-emerald-100" />
        </div>
      </CardContent>
    </Card>
  );
}

function ApprovedCard() {
  return (
    <StatusCard
      icon={<CheckCircle2 className="h-9 w-9 text-emerald-700" />}
      title="Pagamento aprovado"
      tone="success"
    >
      <p>O acesso foi ativado.</p>
      <p className="mt-3">
        Você receberá uma mensagem no WhatsApp informado em seu cadastro.
      </p>
      <p className="mt-3">
        Através dela você poderá iniciar suas análises nutricionais.
      </p>
    </StatusCard>
  );
}

function ExpiredCard({
  onRetry,
  retrying,
}: {
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <StatusCard
      icon={<Clock3 className="h-9 w-9 text-amber-700" />}
      title="Pagamento expirado"
      tone="warning"
    >
      <p>O tempo para pagamento deste PIX terminou.</p>
      <Button
        className="mt-6 rounded-2xl bg-emerald-900 text-white hover:bg-emerald-950"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Gerar novo PIX"}
      </Button>
    </StatusCard>
  );
}

function RejectedCard() {
  return (
    <StatusCard
      icon={<XCircle className="h-9 w-9 text-red-700" />}
      title="Pagamento recusado"
      tone="danger"
    >
      <p>Não foi possível aprovar este pagamento.</p>
      <p className="mt-3">
        Volte aos planos e tente novamente com uma nova tentativa de checkout.
      </p>
      <Button asChild className="mt-6 rounded-2xl bg-emerald-900 text-white">
        <Link to="/#pricing">Voltar aos planos</Link>
      </Button>
    </StatusCard>
  );
}

function SessionExpiredCard({ onRestart }: { onRestart: () => void }) {
  return (
    <StatusCard
      icon={<Clock3 className="h-9 w-9 text-amber-700" />}
      title="Sessão expirada"
      tone="warning"
    >
      <p>
        Por segurança, sua sessão de checkout expirou antes da confirmação do
        pagamento.
      </p>
      <p className="mt-3">
        Refaça o cadastro para gerar uma nova tentativa de checkout.
      </p>
      <Button
        className="mt-6 rounded-2xl bg-emerald-900 text-white hover:bg-emerald-950"
        onClick={onRestart}
      >
        Voltar ao cadastro
      </Button>
    </StatusCard>
  );
}

function StatusCard({
  children,
  icon,
  title,
  tone,
}: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
  tone: "danger" | "success" | "warning";
}) {
  const toneClass = {
    danger: "bg-red-50",
    success: "bg-emerald-50",
    warning: "bg-amber-50",
  }[tone];

  return (
    <Card className="rounded-[2rem] border-zinc-200 bg-white shadow-[0_35px_90px_-45px_rgba(15,23,42,0.24)]">
      <CardContent className="p-8 lg:p-10">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-[1.6rem] ${toneClass}`}
        >
          {icon}
        </div>
        <h2 className="mt-6 text-4xl font-black tracking-[-0.05em]">
          {title}
        </h2>
        <div className="mt-5 text-base leading-8 text-zinc-600">{children}</div>
        <div className="mt-8 flex items-center gap-2 text-sm font-semibold text-zinc-500">
          <Lock className="h-4 w-4 text-emerald-800" />
          Checkout protegido e sem redirecionamento automático para WhatsApp.
        </div>
      </CardContent>
    </Card>
  );
}

function validateForm(form: RegisterFormState): RegisterFormErrors {
  const errors: RegisterFormErrors = {};

  if (form.firstName.trim().length < 2) {
    errors.firstName = "Informe seu nome.";
  }

  if (form.lastName.trim().length < 2) {
    errors.lastName = "Informe seu sobrenome.";
  }

  if (digitsOnly(form.phone).length < 10) {
    errors.phone = "Informe um telefone brasileiro com DDD.";
  }

  if (digitsOnly(form.cpf).length !== 11) {
    errors.cpf = "Informe um CPF com 11 dígitos.";
  }

  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    errors.email = "Informe um email válido.";
  }

  if (form.password.length < 8) {
    errors.password = "A senha precisa ter pelo menos 8 caracteres.";
  }

  return errors;
}

function normalizePayment(
  payment: PixPaymentResponse | PaymentDisplay | null,
): PaymentDisplay | null {
  if (!payment) {
    return null;
  }

  return {
    qrCode: payment.qrCode,
    qrCodeImageUrl: payment.qrCodeImageUrl,
    expiresAt: payment.expiresAt,
  };
}

function createIdempotencyKey(): string {
  if (typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `pix-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }

  return "Tente novamente em instantes.";
}
