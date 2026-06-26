import * as React from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

type BadgeVariantOptions = {
  variant?: BadgeVariant;
};

const baseBadgeClasses =
  "inline-flex select-none items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-[background-color,border-color,color,box-shadow,opacity] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const badgeVariantClasses: Record<BadgeVariant, string> = {
  default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
  secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
  destructive:
    "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
  outline: "text-foreground",
};

function badgeVariants({
  variant = "default",
}: BadgeVariantOptions = {}): string {
  return cn(baseBadgeClasses, badgeVariantClasses[variant]);
}

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: BadgeVariant;
};

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
