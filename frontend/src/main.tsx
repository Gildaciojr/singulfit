import { createRoot } from "react-dom/client";
import "./index.css";

import { AppRoutes } from "@/router";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GlobalEffects from "@/components/GlobalEffects";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <GlobalEffects />
      <AppRoutes />
    </TooltipProvider>
  </QueryClientProvider>
);