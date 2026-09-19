import { FormEvent, ReactNode, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Copy,
  CreditCard,
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
  BillingCycles,
  CHECKOUT_STATUS_LABEL,
  createPixPayment,
  createRecurringCreditCardSubscription,
  getCreditCardPublicKey,
  loginCheckout,
  LoginCheckoutPayload,
  PixPaymentResponse,
  RecurringCreditCardSubscriptionResponse,
  registerCheckout,
  refreshCheckoutSession,
} from "@/lib/api";
import { encryptPagBankCard, loadPagBankSdk } from "@/lib/pagbank-sdk";
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

type LoginFormErrors = Partial<Record<keyof LoginCheckoutPayload, string>>;
type CheckoutMode = "REGISTER" | "LOGIN";

type PaymentMethodOption = "PIX" | "CREDIT_CARD";
const BILLING_CYCLE_OPTIONS: readonly BillingCycles[] = [1, 3, 6, 12];

type CardFormState = {
  holderName: string;
  holderCpf: string;
  cardNumber: string;
  expiry: string;
  cvv: string;
};

type CardFormErrors = Partial<Record<keyof CardFormState, string>>;

type CheckoutRouteParams = {
  planType?: string;
};

type PaymentDisplay = {
  qrCode: string | null;
  qrCodeImageUrl: string | null;
  expiresAt: string | null;
};

type SavedCheckoutSession = AuthTokensResponse;

const initialFormState: RegisterFormState = {
  firstName: "",
  lastName: "",
  phone: "",
  cpf: "",
  email: "",
  password: "",
};

const initialCardFormState: CardFormState = {
  holderName: "",
  holderCpf: "",
  cardNumber: "",
  expiry: "",
  cvv: "",
};

const initialLoginFormState: LoginCheckoutPayload = {
  email: "",
  password: "",
};

export default function Checkout() {
  const params = useParams<CheckoutRouteParams>();
  const navigate = useNavigate();
  const initialPlan = commercialPlanFromRouteParam(params.planType);
  const [selectedPlan, setSelectedPlan] = useState<CommercialPlanType>(
    initialPlan.type,
  );
  const [form, setForm] = useState<RegisterFormState>(initialFormState);
  const [errors, setErrors] = useState<RegisterFormErrors>({});
  const [checkoutMode, setCheckoutMode] = useState<CheckoutMode>("REGISTER");
  const [loginForm, setLoginForm] = useState<LoginCheckoutPayload>(
    initialLoginFormState,
  );
  const [loginErrors, setLoginErrors] = useState<LoginFormErrors>({});
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethodOption>("PIX");
  const [billingCycles, setBillingCycles] = useState<BillingCycles>(1);
  const [cardForm, setCardForm] = useState<CardFormState>(initialCardFormState);
  const [cardErrors, setCardErrors] = useState<CardFormErrors>({});
  const [savedCheckoutSession, setSavedCheckoutSession] =
    useState<SavedCheckoutSession | null>(() => readSavedCheckoutSession());
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [pixPayment, setPixPayment] = useState<PixPaymentResponse | null>(null);
  const [recurringSubscription, setRecurringSubscription] =
    useState<RecurringCreditCardSubscriptionResponse | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [securePaymentLoading, setSecurePaymentLoading] = useState(false);
  const [pollingStartedAt, setPollingStartedAt] = useState<number | null>(null);

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
  const loginMutation = useMutation({
    mutationFn: loginCheckout,
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
  const recurringCreditCardMutation = useMutation({
    mutationFn: ({
      payload,
      token,
    }: {
      payload: Parameters<typeof createRecurringCreditCardSubscription>[0];
      token: string;
    }) => createRecurringCreditCardSubscription(payload, token),
  });

  const currentStatus = checkoutStatus.data?.checkoutStatus;
  const currentPayment = pixPayment ?? checkoutStatus.data?.payment ?? null;
  const activePaymentMethod =
    checkoutStatus.data?.payment?.method === "CREDIT_CARD"
      ? "CREDIT_CARD"
      : paymentMethod;
  const submitting =
    registerMutation.isPending ||
    loginMutation.isPending ||
    pixMutation.isPending ||
    recurringCreditCardMutation.isPending ||
    securePaymentLoading;

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

  function updateCardField(field: keyof CardFormState, value: string): void {
    setCardForm((current) => ({
      ...current,
      [field]: value,
    }));
    setCardErrors((current) => ({
      ...current,
      [field]: undefined,
    }));
  }

  function updateLoginField(
    field: keyof LoginCheckoutPayload,
    value: string,
  ): void {
    setLoginForm((current) => ({ ...current, [field]: value }));
    setLoginErrors((current) => ({ ...current, [field]: undefined }));
  }

  function selectPaymentMethod(nextMethod: PaymentMethodOption): void {
    setPaymentMethod(nextMethod);
    setCardErrors({});
  }

  function selectPlan(nextPlan: CommercialPlanType): void {
    setSelectedPlan(nextPlan);
    navigate(checkoutPath(nextPlan), { replace: true });
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateForm(form);
    const cardValidation =
      paymentMethod === "CREDIT_CARD" ? validateCardForm(cardForm) : {};

    if (
      Object.keys(validation).length > 0 ||
      Object.keys(cardValidation).length > 0
    ) {
      setErrors(validation);
      setCardErrors(cardValidation);
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
      setSavedCheckoutSession(registerResult.tokens);
      setAccessToken(registerResult.tokens.accessToken);
      setRefreshToken(registerResult.tokens.refreshToken);
      setSessionExpired(false);
      setPollingStartedAt(Date.now());

      if (paymentMethod === "PIX") {
        const pix = await pixMutation.mutateAsync(
          registerResult.tokens.accessToken,
        );
        setPixPayment(pix);
        toast({
          title: "PIX gerado",
          description: "Agora é só pagar e aguardar a ativação automática.",
        });
        return;
      }

      const subscription = await createRecurringCreditCardSubscriptionSecurely(
        registerResult.tokens.accessToken,
        registerResult.subscription,
      );

      setRecurringSubscription(subscription);

      toast({
        title: "Assinatura recorrente enviada",
        description:
          "Aguardamos a confirmação financeira para ativar seu acesso.",
      });
    } catch (error: unknown) {
      toast({
        title: "Não foi possível continuar",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateLoginForm(loginForm);

    if (Object.keys(validation).length > 0) {
      setLoginErrors(validation);
      return;
    }

    try {
      const loginResult = await loginMutation.mutateAsync({
        email: loginForm.email.trim().toLowerCase(),
        password: loginForm.password,
      });

      saveCheckoutSession(loginResult.tokens, selectedPlan);
      setSavedCheckoutSession(loginResult.tokens);
      setAccessToken(loginResult.tokens.accessToken);
      setRefreshToken(loginResult.tokens.refreshToken);
      setLoginForm(initialLoginFormState);
      setSessionExpired(false);
      setPollingStartedAt(Date.now());
    } catch (error: unknown) {
      toast({
        title: "Não foi possível entrar",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  }

  async function submitPendingCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const subscription = checkoutStatus.data?.subscription;
    const cardValidation =
      paymentMethod === "CREDIT_CARD" ? validateCardForm(cardForm) : {};

    if (
      !accessToken ||
      !subscription ||
      Object.keys(cardValidation).length > 0
    ) {
      setCardErrors(cardValidation);
      return;
    }

    try {
      if (paymentMethod === "PIX") {
        const pix = await createPixWithSessionRefresh();
        setPixPayment(pix);
        setPollingStartedAt(Date.now());
        return;
      }

      const recurring = await createRecurringCreditCardSubscriptionSecurely(
        accessToken,
        { id: subscription.id, planId: subscription.plan.id },
      );
      setRecurringSubscription(recurring);
    } catch (error: unknown) {
      toast({
        title: "Não foi possível retomar o checkout",
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
    setSavedCheckoutSession(tokens);
    setAccessToken(tokens.accessToken);
    setRefreshToken(tokens.refreshToken);
    setSessionExpired(false);
  }

  function expireCheckoutSession(): void {
    clearCheckoutSession();
    setSavedCheckoutSession(null);
    setAccessToken(null);
    setRefreshToken(null);
    setPollingStartedAt(null);
    setSessionExpired(true);
  }

  function continueSavedCheckout(): void {
    if (!savedCheckoutSession) {
      return;
    }

    setAccessToken(savedCheckoutSession.accessToken);
    setRefreshToken(savedCheckoutSession.refreshToken);
    setSessionExpired(false);
    setPollingStartedAt(Date.now());
  }

  function startNewCheckout(): void {
    clearCheckoutSession();
    setSavedCheckoutSession(null);
    setAccessToken(null);
    setRefreshToken(null);
    setPixPayment(null);
    setRecurringSubscription(null);
    setPollingStartedAt(null);
    setSessionExpired(false);
    setCheckoutMode("REGISTER");
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

  async function createRecurringCreditCardSubscriptionSecurely(
    token: string,
    subscription: { id: string; planId: string },
  ): Promise<RecurringCreditCardSubscriptionResponse> {
    const expiry = parseExpiry(cardForm.expiry);

    if (!expiry) {
      throw new ApiError("Informe uma validade válida para o cartão.", 400);
    }

    setSecurePaymentLoading(true);

    try {
      const [{ publicKey }, sdk] = await Promise.all([
        getCreditCardPublicKey(token),
        loadPagBankSdk(),
      ]);
      const encryptedCard = encryptPagBankCard(sdk, {
        publicKey,
        holderName: cardForm.holderName.trim(),
        cardNumber: digitsOnly(cardForm.cardNumber),
        expMonth: expiry.month,
        expYear: expiry.year,
        securityCode: digitsOnly(cardForm.cvv),
      });

      setCardForm((current) => ({
        ...current,
        cardNumber: "",
        expiry: "",
        cvv: "",
      }));

      return await recurringCreditCardMutation.mutateAsync({
        token,
        payload: {
          subscriptionId: subscription.id,
          planId: subscription.planId,
          billingCycles,
          encryptedCard,
          holderName: cardForm.holderName.trim(),
          holderCpf: digitsOnly(cardForm.holderCpf),
        },
      });
    } catch (error: unknown) {
      if (error instanceof ApiError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new ApiError(error.message, 400);
      }

      throw new ApiError(
        "Não foi possível carregar o ambiente seguro de pagamento.",
        400,
      );
    } finally {
      setSecurePaymentLoading(false);
    }
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

      <div className="container mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
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
            <SessionExpiredCard
              onRestart={() => {
                setSessionExpired(false);
                setCheckoutMode("LOGIN");
              }}
            />
          ) : !accessToken && savedCheckoutSession ? (
            <SavedCheckoutCard
              onContinue={continueSavedCheckout}
              onStartNew={startNewCheckout}
            />
          ) : !accessToken ? (
            checkoutMode === "LOGIN" ? (
              <LoginCard
                errors={loginErrors}
                form={loginForm}
                onChange={updateLoginField}
                onRegister={() => setCheckoutMode("REGISTER")}
                onSubmit={submitLogin}
                submitting={submitting}
              />
            ) : (
              <RegisterCard
                cardErrors={cardErrors}
                cardForm={cardForm}
                billingCycles={billingCycles}
                errors={errors}
                form={form}
                onCardChange={updateCardField}
                onBillingCyclesChange={setBillingCycles}
                onChange={updateField}
                onLogin={() => setCheckoutMode("LOGIN")}
                onPaymentMethodChange={selectPaymentMethod}
                onSubmit={submitRegister}
                paymentMethod={paymentMethod}
                plan={plan}
                submitting={submitting}
              />
            )
          ) : currentStatus === "ACTIVE" ? (
            <ApprovedCard />
          ) : currentStatus === "WAITING_PAYMENT" &&
            checkoutStatus.data?.subscription?.status === "PENDING_PAYMENT" &&
            !checkoutStatus.data.payment ? (
            <PendingCheckoutCard
              cardErrors={cardErrors}
              cardForm={cardForm}
              billingCycles={billingCycles}
              onBillingCyclesChange={setBillingCycles}
              onCardChange={updateCardField}
              onPaymentMethodChange={selectPaymentMethod}
              onSubmit={submitPendingCheckout}
              paymentMethod={paymentMethod}
              plan={plan}
              submitting={submitting}
            />
          ) : currentStatus === "PAYMENT_EXPIRED" ? (
            <ExpiredCard
              onRetry={retryPix}
              onStartNew={startNewCheckout}
              retrying={pixMutation.isPending}
            />
          ) : currentStatus === "PAYMENT_FAILED" ? (
            <RejectedCard onStartNew={startNewCheckout} />
          ) : activePaymentMethod === "CREDIT_CARD" ? (
            <CreditCardStatusCard
              loading={
                recurringCreditCardMutation.isPending || securePaymentLoading
              }
              subscription={recurringSubscription}
              polling={checkoutStatus.isFetching}
              statusLabel={
                currentStatus
                  ? CHECKOUT_STATUS_LABEL[currentStatus]
                  : "Processando cartão"
              }
            />
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
        <img src={singulfitLogo} alt="SingulFit" className="h-18 w-auto" />
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
        <CardContent className="p-5 sm:p-7">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
            <ShieldCheck className="h-4 w-4" />
            Plano selecionado
          </div>

          <h1 className="mt-6 text-3xl font-black tracking-[-0.055em] text-zinc-950 sm:text-4xl">
            {plan.displayName}
          </h1>

          <div className="mt-4 flex items-end gap-2">
            <span className="text-4xl font-black tracking-[-0.06em] sm:text-5xl">
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
  cardErrors,
  cardForm,
  billingCycles,
  errors,
  form,
  onCardChange,
  onBillingCyclesChange,
  onChange,
  onLogin,
  onPaymentMethodChange,
  onSubmit,
  paymentMethod,
  plan,
  submitting,
}: {
  cardErrors: CardFormErrors;
  cardForm: CardFormState;
  billingCycles: BillingCycles;
  errors: RegisterFormErrors;
  form: RegisterFormState;
  onCardChange: (field: keyof CardFormState, value: string) => void;
  onBillingCyclesChange: (billingCycles: BillingCycles) => void;
  onChange: (field: keyof RegisterFormState, value: string) => void;
  onLogin: () => void;
  onPaymentMethodChange: (method: PaymentMethodOption) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  paymentMethod: PaymentMethodOption;
  plan: CommercialPlan;
  submitting: boolean;
}) {
  return (
    <Card className="rounded-[2rem] border-zinc-200 bg-white shadow-[0_35px_90px_-45px_rgba(15,23,42,0.24)]">
      <CardContent className="p-5 sm:p-7 lg:p-9">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
            Cadastro
          </div>
          <h2 className="mt-5 text-3xl font-black tracking-[-0.04em]">
            {paymentMethod === "PIX"
              ? "Crie seu acesso para gerar o PIX."
              : "Crie seu acesso para pagar com cartão."}
          </h2>
          <p className="mt-3 text-sm leading-7 text-zinc-600">
            O CPF é obrigatório aqui porque o provedor de pagamento exige esse
            dado para processar o pagamento.
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

          <PaymentMethodSelector
            paymentMethod={paymentMethod}
            onChange={onPaymentMethodChange}
          />

          {paymentMethod === "CREDIT_CARD" && (
            <>
              <RecurringDurationSelector
                billingCycles={billingCycles}
                onChange={onBillingCyclesChange}
                plan={plan}
              />
              <CreditCardForm
                errors={cardErrors}
                form={cardForm}
                onChange={onCardChange}
              />
            </>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="h-14 w-full rounded-2xl bg-emerald-900 text-base font-bold text-white hover:bg-emerald-950"
          >
            {submitting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {paymentMethod === "PIX"
                  ? "Gerando PIX..."
                  : "Processando cartão com segurança..."}
              </>
            ) : (
              <>
                {paymentMethod === "PIX" ? "Gerar PIX" : "Assinar com cartão"}
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full rounded-2xl"
            disabled={submitting}
            onClick={onLogin}
          >
            Já tenho uma conta
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LoginCard({
  errors,
  form,
  onChange,
  onRegister,
  onSubmit,
  submitting,
}: {
  errors: LoginFormErrors;
  form: LoginCheckoutPayload;
  onChange: (field: keyof LoginCheckoutPayload, value: string) => void;
  onRegister: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  submitting: boolean;
}) {
  return (
    <Card className="rounded-[2rem] border-zinc-200 bg-white shadow-[0_35px_90px_-45px_rgba(15,23,42,0.24)]">
      <CardContent className="p-5 sm:p-7 lg:p-9">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
            Acessar checkout
          </div>
          <h2 className="mt-5 text-3xl font-black tracking-[-0.04em]">
            Entre para retomar seu checkout.
          </h2>
          <p className="mt-3 text-sm leading-7 text-zinc-600">
            Após entrar, mostramos o estado atual da sua assinatura sem criar
            uma nova cobrança.
          </p>
        </div>

        <form className="space-y-5" onSubmit={onSubmit}>
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
          <Button
            type="submit"
            disabled={submitting}
            className="h-14 w-full rounded-2xl bg-emerald-900 text-base font-bold text-white hover:bg-emerald-950"
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                Entrar e retomar checkout
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full rounded-2xl"
            disabled={submitting}
            onClick={onRegister}
          >
            Criar uma conta
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PendingCheckoutCard({
  cardErrors,
  cardForm,
  billingCycles,
  onBillingCyclesChange,
  onCardChange,
  onPaymentMethodChange,
  onSubmit,
  paymentMethod,
  plan,
  submitting,
}: {
  cardErrors: CardFormErrors;
  cardForm: CardFormState;
  billingCycles: BillingCycles;
  onBillingCyclesChange: (billingCycles: BillingCycles) => void;
  onCardChange: (field: keyof CardFormState, value: string) => void;
  onPaymentMethodChange: (method: PaymentMethodOption) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  paymentMethod: PaymentMethodOption;
  plan: CommercialPlan;
  submitting: boolean;
}) {
  return (
    <Card className="rounded-[2rem] border-zinc-200 bg-white shadow-[0_35px_90px_-45px_rgba(15,23,42,0.24)]">
      <CardContent className="p-5 sm:p-7 lg:p-9">
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-amber-900">
            Checkout pendente
          </div>
          <h2 className="mt-5 text-3xl font-black tracking-[-0.04em]">
            Retome o pagamento da sua assinatura.
          </h2>
          <p className="mt-3 text-sm leading-7 text-zinc-600">
            Usaremos a assinatura pendente existente. Seu acesso só será ativado
            após a confirmação financeira.
          </p>
        </div>

        <form className="space-y-5" onSubmit={onSubmit}>
          <PaymentMethodSelector
            paymentMethod={paymentMethod}
            onChange={onPaymentMethodChange}
          />
          {paymentMethod === "CREDIT_CARD" && (
            <>
              <RecurringDurationSelector
                billingCycles={billingCycles}
                onChange={onBillingCyclesChange}
                plan={plan}
              />
              <CreditCardForm
                errors={cardErrors}
                form={cardForm}
                onChange={onCardChange}
              />
            </>
          )}
          <Button
            type="submit"
            disabled={submitting}
            className="h-14 w-full rounded-2xl bg-emerald-900 text-base font-bold text-white hover:bg-emerald-950"
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                {paymentMethod === "PIX" ? "Gerar PIX" : "Assinar com cartão"}
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PaymentMethodSelector({
  onChange,
  paymentMethod,
}: {
  onChange: (method: PaymentMethodOption) => void;
  paymentMethod: PaymentMethodOption;
}) {
  return (
    <div>
      <Label>Forma de pagamento</Label>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onChange("PIX")}
          className={`rounded-2xl border p-4 text-left transition ${
            paymentMethod === "PIX"
              ? "border-emerald-800 bg-emerald-50 text-emerald-950"
              : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-200"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-black">
            <ShieldCheck className="h-4 w-4" />
            PIX
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-600">
            Geração instantânea com QR Code e copia e cola.
          </p>
        </button>

        <button
          type="button"
          onClick={() => onChange("CREDIT_CARD")}
          className={`rounded-2xl border p-4 text-left transition ${
            paymentMethod === "CREDIT_CARD"
              ? "border-emerald-800 bg-emerald-50 text-emerald-950"
              : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-200"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-black">
            <CreditCard className="h-4 w-4" />
            Cartão de Crédito
          </div>
          <p className="mt-2 text-xs leading-5 text-zinc-600">
            Cobrança mensal recorrente com criptografia PagBank.
          </p>
        </button>
      </div>
    </div>
  );
}

function RecurringDurationSelector({
  billingCycles,
  onChange,
  plan,
}: {
  billingCycles: BillingCycles;
  onChange: (billingCycles: BillingCycles) => void;
  plan: CommercialPlan;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
      <Label>Período da assinatura</Label>
      <p className="mt-2 text-sm font-semibold text-zinc-950">
        {recurringPlanText(plan, billingCycles)}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BILLING_CYCLE_OPTIONS.map((cycles) => (
          <Button
            key={cycles}
            type="button"
            variant={cycles === billingCycles ? "default" : "outline"}
            className="rounded-xl"
            onClick={() => onChange(cycles)}
          >
            {cycles} {cycles === 1 ? "mês" : "meses"}
          </Button>
        ))}
      </div>
    </div>
  );
}

function CreditCardForm({
  errors,
  form,
  onChange,
}: {
  errors: CardFormErrors;
  form: CardFormState;
  onChange: (field: keyof CardFormState, value: string) => void;
}) {
  return (
    <div className="rounded-[1.6rem] border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-zinc-950">
        <Lock className="h-4 w-4 text-emerald-800" />
        Dados criptografados no ambiente seguro PagBank
      </div>

      <div className="mt-4 grid gap-4">
        <FormField
          error={errors.holderName}
          label="Nome do titular"
          onChange={(value) => onChange("holderName", value)}
          placeholder="Como está no cartão"
          value={form.holderName}
        />
        <FormField
          error={errors.holderCpf}
          inputMode="numeric"
          label="CPF do titular"
          onChange={(value) => onChange("holderCpf", value)}
          placeholder="000.000.000-00"
          value={form.holderCpf}
        />
        <FormField
          error={errors.cardNumber}
          inputMode="numeric"
          label="Número do cartão"
          onChange={(value) => onChange("cardNumber", value)}
          placeholder="0000 0000 0000 0000"
          value={form.cardNumber}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            error={errors.expiry}
            inputMode="numeric"
            label="Validade"
            onChange={(value) => onChange("expiry", value)}
            placeholder="MM/AA"
            value={form.expiry}
          />
          <FormField
            error={errors.cvv}
            inputMode="numeric"
            label="CVV"
            onChange={(value) => onChange("cvv", value)}
            placeholder="123"
            value={form.cvv}
          />
        </div>
      </div>
    </div>
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
      {error && (
        <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>
      )}
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

        <div className="mt-8 rounded-[1.6rem] border border-zinc-200 bg-zinc-50 p-4 sm:p-5">
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
                    className="aspect-square w-full max-w-64 rounded-2xl border border-zinc-200 bg-white object-contain p-3"
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
            {polling && (
              <RefreshCw className="h-5 w-5 animate-spin text-emerald-900" />
            )}
          </div>
          <Progress value={65} className="mt-4 h-2 bg-emerald-100" />
        </div>
      </CardContent>
    </Card>
  );
}

function CreditCardStatusCard({
  loading,
  subscription,
  polling,
  statusLabel,
}: {
  loading: boolean;
  subscription: RecurringCreditCardSubscriptionResponse | null;
  polling: boolean;
  statusLabel: string;
}) {
  return (
    <Card className="rounded-[2rem] border-zinc-200 bg-white shadow-[0_35px_90px_-45px_rgba(15,23,42,0.24)]">
      <CardContent className="p-7 lg:p-9">
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.16em] text-emerald-900">
          <CreditCard className="h-4 w-4" />
          {statusLabel}
        </div>

        <h2 className="mt-5 text-3xl font-black tracking-[-0.04em]">
          Pagamento com cartão em processamento.
        </h2>
        <p className="mt-3 text-sm leading-7 text-zinc-600">
          Seus dados sensíveis foram criptografados pelo ambiente seguro do
          PagBank. Agora estamos aguardando a confirmação automática.
        </p>

        <div className="mt-8 rounded-[1.6rem] border border-zinc-200 bg-zinc-50 p-5">
          <div className="flex items-center gap-3">
            {loading ? (
              <Loader2 className="h-6 w-6 animate-spin text-emerald-900" />
            ) : (
              <ShieldCheck className="h-6 w-6 text-emerald-900" />
            )}
            <div>
              <div className="text-sm font-bold text-zinc-950">
                {loading
                  ? "Processando cartão com segurança..."
                  : "Cartão enviado com segurança"}
              </div>
              <div className="mt-1 text-xs text-zinc-600">
                {subscription?.externalSubscriptionId
                  ? `Referência PagBank: ${subscription.externalSubscriptionId}`
                  : "A tela será atualizada automaticamente."}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl bg-emerald-50 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-bold text-emerald-950">
                Aguardando confirmação
              </div>
              <div className="mt-1 text-xs text-emerald-900/75">
                Assim que o PagBank confirmar, seu acesso será ativado.
              </div>
            </div>
            {polling && (
              <RefreshCw className="h-5 w-5 animate-spin text-emerald-900" />
            )}
          </div>
          <Progress value={55} className="mt-4 h-2 bg-emerald-100" />
        </div>
      </CardContent>
    </Card>
  );
}

function SavedCheckoutCard({
  onContinue,
  onStartNew,
}: {
  onContinue: () => void;
  onStartNew: () => void;
}) {
  return (
    <StatusCard
      icon={<Clock3 className="h-9 w-9 text-emerald-800" />}
      title="Pagamento encontrado"
      tone="warning"
    >
      <p>Encontramos um pagamento iniciado anteriormente.</p>
      <p className="mt-3">
        Você pode continuar esse pagamento ou iniciar um novo checkout.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Button
          className="rounded-2xl bg-emerald-900 text-white hover:bg-emerald-950"
          onClick={onContinue}
        >
          Continuar pagamento
        </Button>
        <Button className="rounded-2xl" variant="outline" onClick={onStartNew}>
          Iniciar novo checkout
        </Button>
      </div>
    </StatusCard>
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
  onStartNew,
  onRetry,
  retrying,
}: {
  onStartNew: () => void;
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
        {retrying ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          "Gerar novo PIX"
        )}
      </Button>
      <Button
        className="ml-0 mt-3 rounded-2xl sm:ml-3 sm:mt-6"
        variant="outline"
        onClick={onStartNew}
      >
        Iniciar novo checkout
      </Button>
    </StatusCard>
  );
}

function RejectedCard({ onStartNew }: { onStartNew: () => void }) {
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
      <Button
        className="ml-0 mt-3 rounded-2xl sm:ml-3 sm:mt-6"
        variant="outline"
        onClick={onStartNew}
      >
        Iniciar novo checkout
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
        Entre novamente para consultar e retomar o checkout pendente.
      </p>
      <Button
        className="mt-6 rounded-2xl bg-emerald-900 text-white hover:bg-emerald-950"
        onClick={onRestart}
      >
        Entrar novamente
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
      <CardContent className="p-6 sm:p-8 lg:p-10">
        <div
          className={`flex h-20 w-20 items-center justify-center rounded-[1.6rem] ${toneClass}`}
        >
          {icon}
        </div>
        <h2 className="mt-6 text-4xl font-black tracking-[-0.05em]">{title}</h2>
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

function validateLoginForm(form: LoginCheckoutPayload): LoginFormErrors {
  const errors: LoginFormErrors = {};

  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    errors.email = "Informe um email válido.";
  }

  if (form.password.length < 8) {
    errors.password = "A senha precisa ter pelo menos 8 caracteres.";
  }

  return errors;
}

function validateCardForm(form: CardFormState): CardFormErrors {
  const errors: CardFormErrors = {};
  const cardNumber = digitsOnly(form.cardNumber);
  const cvv = digitsOnly(form.cvv);

  if (form.holderName.trim().length < 3) {
    errors.holderName = "Informe o nome do titular.";
  }

  if (!isValidCpf(form.holderCpf)) {
    errors.holderCpf = "Informe um CPF de titular válido.";
  }

  if (
    cardNumber.length < 13 ||
    cardNumber.length > 19 ||
    !passesLuhn(cardNumber)
  ) {
    errors.cardNumber = "Informe um número de cartão válido.";
  }

  if (!parseExpiry(form.expiry)) {
    errors.expiry = "Informe uma validade futura no formato MM/AA.";
  }

  if (cvv.length < 3 || cvv.length > 4) {
    errors.cvv = "Informe um CVV com 3 ou 4 dígitos.";
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

function readSavedCheckoutSession(): SavedCheckoutSession | null {
  const accessToken = readCheckoutAccessToken();
  const refreshToken = readCheckoutRefreshToken();

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
  };
}

function recurringPlanText(
  plan: CommercialPlan,
  billingCycles: BillingCycles,
): string {
  const months = billingCycles === 1 ? "mês" : "meses";
  return `${formatPlanPrice(plan.price)}/mês por ${billingCycles} ${months}`;
}

function createIdempotencyKey(prefix: "pix" | "card" = "pix"): string {
  if (typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function isValidCpf(value: string): boolean {
  const cpf = digitsOnly(value);

  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
    return false;
  }

  const firstDigit = calculateCpfDigit(cpf.slice(0, 9));
  const secondDigit = calculateCpfDigit(`${cpf.slice(0, 9)}${firstDigit}`);

  return cpf === `${cpf.slice(0, 9)}${firstDigit}${secondDigit}`;
}

function calculateCpfDigit(base: string): number {
  const factorStart = base.length + 1;
  const total = base
    .split("")
    .reduce(
      (sum, digit, index) =>
        sum + Number.parseInt(digit, 10) * (factorStart - index),
      0,
    );
  const remainder = total % 11;

  return remainder < 2 ? 0 : 11 - remainder;
}

function passesLuhn(value: string): boolean {
  let sum = 0;
  let shouldDouble = false;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number.parseInt(value[index], 10);

    if (!Number.isInteger(digit)) {
      return false;
    }

    if (shouldDouble) {
      digit *= 2;

      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum > 0 && sum % 10 === 0;
}

function parseExpiry(value: string): { month: string; year: string } | null {
  const match = value.trim().match(/^(\d{1,2})\s*\/?\s*(\d{2}|\d{4})$/);

  if (!match) {
    return null;
  }

  const month = Number.parseInt(match[1], 10);
  const rawYear = match[2];
  const year =
    rawYear.length === 2
      ? 2000 + Number.parseInt(rawYear, 10)
      : Number.parseInt(rawYear, 10);

  if (month < 1 || month > 12) {
    return null;
  }

  const now = new Date();
  const expiryEnd = new Date(year, month, 0, 23, 59, 59, 999);

  if (expiryEnd.getTime() < now.getTime()) {
    return null;
  }

  return {
    month: month.toString().padStart(2, "0"),
    year: year.toString(),
  };
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
