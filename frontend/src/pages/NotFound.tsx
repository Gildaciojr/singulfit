// src/pages/NotFound.tsx
import React from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Ghost } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center text-foreground">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <Ghost className="h-8 w-8 text-muted-foreground" />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Parece que essa rota não existe mais ou foi movida. Mas não se preocupe, você pode voltar para a página
        principal e continuar explorando a LucyFit.
      </p>

      <Button asChild className="mt-6">
        <a href="/">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar para a página inicial
        </a>
      </Button>
    </div>
  );
}
