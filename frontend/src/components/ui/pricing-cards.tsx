"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CheckIcon, ArrowRightIcon } from "@radix-ui/react-icons";
import { X } from "lucide-react";

export interface PricingFeature {
  name: string;
  highlight?: boolean;
  included: boolean;
}

export interface PricingTier {
  name: string;
  price: number;
  interval?: string;
  description: string;
  features: PricingFeature[];
  highlight?: boolean;
  cta?: {
    text: string;
    href?: string;
    onClick?: () => void;
  };
}

export interface PricingCardsProps extends React.HTMLAttributes<HTMLDivElement> {
  tiers: PricingTier[];
  containerClassName?: string;
  cardClassName?: string;
  sectionClassName?: string;
}

export function PricingCards({
  tiers,
  className,
  containerClassName,
  cardClassName,
  sectionClassName,
  ...props
}: PricingCardsProps) {
  return (
    <section
      className={cn(
        "bg-background text-foreground",
        "py-12 sm:py-20 md:py-32 px-4",
        "fade-bottom overflow-hidden pb-0",
        sectionClassName,
      )}
    >
      <div
        className={cn("w-full max-w-5xl mx-auto px-4", containerClassName)}
        {...props}
      >
        <div
          className={cn(
            "grid grid-cols-1 gap-8",
            tiers.length > 1 && "md:grid-cols-2",
            tiers.length === 1 && "justify-items-center",
            className,
          )}
        >
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={cn(
                "relative group w-full",
                tiers.length === 1 && "max-w-md mx-auto",
                "rounded-2xl transition-all duration-500",
                tier.highlight
                  ? "bg-gradient-to-b from-purple-900 to-purple-950 dark:from-purple-900 dark:to-purple-950"
                  : "bg-white dark:bg-background",
                "border",
                tier.highlight ? "border-primary/30" : "border-border",
                "hover:border-primary/50",
                "hover:shadow-[0_8px_40px_-12px_hsl(280_75%_60%/0.3)]",
                cardClassName,
              )}
            >
              <div className="p-6 md:p-8 flex flex-col h-full">
                <div className="space-y-3">
                  <h3
                    className={cn(
                      "text-base uppercase tracking-wider font-medium",
                      tier.highlight ? "text-white" : "text-foreground",
                    )}
                  >
                    {tier.name}
                  </h3>

                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        "text-4xl font-light",
                        tier.highlight ? "text-white" : "text-foreground",
                      )}
                    >
                      R$ {tier.price.toFixed(2).replace(".", ",")}
                    </span>

                    <span
                      className={cn(
                        "text-xs",
                        tier.highlight
                          ? "text-purple-300"
                          : "text-muted-foreground",
                      )}
                    >
                      {tier.interval || "pagamento único"}
                    </span>
                  </div>

                  <p
                    className={cn(
                      "text-xs pb-4 border-b",
                      tier.highlight
                        ? "text-purple-300 border-purple-800"
                        : "text-muted-foreground border-border",
                    )}
                  >
                    {tier.description}
                  </p>
                </div>

                <div className="mt-6 space-y-2 flex-grow">
                  {tier.features.map((feature) => (
                    <div key={feature.name} className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center",
                          feature.included
                            ? tier.highlight
                              ? "text-white"
                              : "text-primary"
                            : "text-red-500 dark:text-red-400",
                        )}
                      >
                        {feature.included ? (
                          <CheckIcon className="w-3.5 h-3.5" />
                        ) : (
                          <X className="w-3.5 h-3.5" />
                        )}
                      </div>

                      <span
                        className={cn(
                          "text-xs",
                          tier.highlight
                            ? "text-purple-200"
                            : "text-foreground/80",
                        )}
                      >
                        {feature.name}
                      </span>
                    </div>
                  ))}
                </div>

                {tier.cta && (
                  <div className="mt-8">
                    <Button
                      className={cn(
                        "w-full h-11 group relative",
                        tier.highlight
                          ? "bg-white hover:bg-purple-50 text-purple-900"
                          : "bg-primary hover:bg-primary/90 text-primary-foreground",
                        "transition-all duration-300",
                      )}
                      onClick={!tier.cta.href ? tier.cta.onClick : undefined}
                    >
                      {tier.cta.href ? (
                        <a
                          href={tier.cta.href}
                          className="relative z-10 flex items-center justify-center gap-2 font-medium tracking-wide w-full"
                        >
                          {tier.cta.text}
                          <ArrowRightIcon className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </a>
                      ) : (
                        <span className="relative z-10 flex items-center justify-center gap-2 font-medium tracking-wide">
                          {tier.cta.text}
                          <ArrowRightIcon className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                        </span>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}