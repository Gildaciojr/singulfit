import { useQuery } from "@tanstack/react-query";
import { getCommercialCatalog } from "@/lib/api";
import { resolveCommercialOffers } from "@/lib/commercial-offers";

export function useCommercialOffers() {
  return useQuery({
    queryKey: ["commercial-current-offers"],
    queryFn: async () => resolveCommercialOffers(await getCommercialCatalog()),
    staleTime: 30_000,
    retry: false,
  });
}
