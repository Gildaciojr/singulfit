import { useQuery } from "@tanstack/react-query";
import {
  ApiError,
  AuthTokensResponse,
  CheckoutStatusResponse,
  getCheckoutStatus,
  refreshCheckoutSession,
  TERMINAL_CHECKOUT_STATUSES,
} from "@/lib/api";

type UseCheckoutStatusInput = {
  accessToken: string | null;
  refreshToken: string | null;
  pollingStartedAt: number | null;
  onSessionExpired: () => void;
  onTokenRefresh: (tokens: AuthTokensResponse) => void;
};

export function useCheckoutStatus({
  accessToken,
  refreshToken,
  onSessionExpired,
  onTokenRefresh,
  pollingStartedAt,
}: UseCheckoutStatusInput) {
  return useQuery<CheckoutStatusResponse>({
    queryKey: ["checkout-status", accessToken],
    queryFn: async () => {
      if (!accessToken) {
        throw new ApiError("Sessão de checkout expirada.", 401);
      }

      try {
        return await getCheckoutStatus(accessToken);
      } catch (error: unknown) {
        if (!(error instanceof ApiError) || error.statusCode !== 401) {
          throw error;
        }

        if (!refreshToken) {
          onSessionExpired();
          throw error;
        }

        try {
          const refreshed = await refreshCheckoutSession(refreshToken);

          onTokenRefresh(refreshed.tokens);

          return getCheckoutStatus(refreshed.tokens.accessToken);
        } catch (refreshError: unknown) {
          onSessionExpired();
          throw refreshError;
        }
      }
    },
    enabled: Boolean(accessToken),
    refetchInterval: (query) => {
      const status = query.state.data?.checkoutStatus;

      if (!status || TERMINAL_CHECKOUT_STATUSES.has(status)) {
        return false;
      }

      const elapsed = pollingStartedAt ? Date.now() - pollingStartedAt : 0;

      return elapsed < 60_000 ? 3_000 : 5_000;
    },
  });
}
