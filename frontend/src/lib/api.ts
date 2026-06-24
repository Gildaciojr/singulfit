import { CommercialPlanType } from "@/lib/commercial-plans";

const DEFAULT_API_BASE_URL = import.meta.env.DEV
  ? "http://localhost:3000/api/v1"
  : "https://api.singulfit.com.br/api/v1";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  DEFAULT_API_BASE_URL;

export type CheckoutStatus =
  | "NO_PENDING_CHECKOUT"
  | "WAITING_PAYMENT"
  | "PAYMENT_EXPIRED"
  | "PAYMENT_FAILED"
  | "PAID_ACTIVATING"
  | "ACTIVE"
  | "PAST_DUE"
  | "EXPIRED";

export const CHECKOUT_STATUS_LABEL: Record<CheckoutStatus, string> = {
  NO_PENDING_CHECKOUT: "Nenhum checkout pendente",
  WAITING_PAYMENT: "Aguardando pagamento",
  PAYMENT_EXPIRED: "Pagamento expirado",
  PAYMENT_FAILED: "Pagamento recusado",
  PAID_ACTIVATING: "Pagamento confirmado, ativando acesso",
  ACTIVE: "Pagamento aprovado",
  PAST_DUE: "Assinatura com pendência",
  EXPIRED: "Assinatura expirada",
};

export const TERMINAL_CHECKOUT_STATUSES = new Set<CheckoutStatus>([
  "ACTIVE",
  "PAYMENT_FAILED",
  "PAYMENT_EXPIRED",
]);

export type RegisterCheckoutPayload = {
  name: string;
  phone: string;
  cpf: string;
  email: string;
  password: string;
  planType: CommercialPlanType;
};

export type AuthTokensResponse = {
  accessToken: string;
  refreshToken: string;
};

export type RefreshCheckoutResponse = {
  tokens: AuthTokensResponse;
};

export type RegisterCheckoutResponse = {
  message: string;
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string;
  };
  subscription: {
    id: string;
    status: string;
  };
  tokens: AuthTokensResponse;
};

export type CreatePixPayload = {
  idempotencyKey: string;
};

export type CreateCreditCardPayload = {
  encryptedCard: string;
  holderName: string;
  holderCpf: string;
  installments: 1;
  idempotencyKey: string;
};

export type PixPaymentResponse = {
  paymentId: string;
  invoiceId: string;
  provider: string;
  status: string;
  amount: string;
  currency: "BRL";
  externalReference: string;
  providerPaymentId: string;
  qrCode: string;
  qrCodeImageUrl: string;
  expiresAt: string;
};

export type CreditCardPaymentResponse = {
  paymentId: string;
  invoiceId: string;
  provider: string;
  status: string;
  amount: string;
  currency: "BRL";
  externalReference: string;
  providerPaymentId: string;
  providerOrderId: string;
  approvedAt: string | null;
};

export type CreditCardPublicKeyResponse = {
  publicKey: string;
};

export type CheckoutStatusResponse = {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string;
    phoneE164: string | null;
  };
  subscription: {
    id: string;
    status: string;
    amount: string;
    plan: {
      id: string;
      type: CommercialPlanType;
      name: string;
      price: string;
      currency: "BRL";
      imageLimit: number;
    };
    paidAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    gracePeriodEnd: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  invoice: {
    id: string;
    status: string;
    cycleNumber: number;
    total: string;
    currency: "BRL";
    dueAt: string;
    paidAt: string | null;
    periodStart: string;
    periodEnd: string;
  } | null;
  payment: {
    id: string;
    provider: string;
    method: string;
    status: string;
    amount: string;
    currency: "BRL";
    externalReference: string;
    providerOrderId: string | null;
    providerPaymentId: string | null;
    qrCode: string | null;
    qrCodeImageUrl: string | null;
    expiresAt: string | null;
    approvedAt: string | null;
    failedAt: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  checkoutStatus: CheckoutStatus;
};

type ApiErrorPayload = {
  message?: string | string[];
  error?: string;
  statusCode?: number;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function registerCheckout(
  payload: RegisterCheckoutPayload,
): Promise<RegisterCheckoutResponse> {
  return request("/auth/register", {
    method: "POST",
    body: payload,
  });
}

export function createPixPayment(
  payload: CreatePixPayload,
  accessToken: string,
): Promise<PixPaymentResponse> {
  return request(
    "/payments/pix",
    {
      method: "POST",
      body: payload,
    },
    accessToken,
  );
}

export function createCreditCardPayment(
  payload: CreateCreditCardPayload,
  accessToken: string,
): Promise<CreditCardPaymentResponse> {
  return request(
    "/payments/credit-card",
    {
      method: "POST",
      body: payload,
    },
    accessToken,
  );
}

export function getCreditCardPublicKey(
  accessToken: string,
): Promise<CreditCardPublicKeyResponse> {
  return request(
    "/payments/credit-card/public-key",
    {
      method: "GET",
    },
    accessToken,
  );
}

export function getCheckoutStatus(
  accessToken: string,
): Promise<CheckoutStatusResponse> {
  return request(
    "/checkout/status",
    {
      method: "GET",
    },
    accessToken,
  );
}

export function refreshCheckoutSession(
  refreshToken: string,
): Promise<RefreshCheckoutResponse> {
  return request("/auth/refresh", {
    method: "POST",
    body: {
      refreshToken,
    },
  });
}

async function request<TResponse>(
  path: string,
  options: {
    method: "GET" | "POST";
    body?: unknown;
  },
  accessToken?: string,
): Promise<TResponse> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new ApiError(
      await extractErrorMessage(response),
      response.status,
    );
  }

  return (await response.json()) as TResponse;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    const message = payload.message;

    if (Array.isArray(message)) {
      return message.join(" ");
    }

    if (message) {
      return message;
    }

    if (payload.error) {
      return payload.error;
    }
  } catch {
    return "Não foi possível concluir a solicitação.";
  }

  return "Não foi possível concluir a solicitação.";
}
