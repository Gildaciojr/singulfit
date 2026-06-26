import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

type ButtonSize = "default" | "sm" | "lg" | "icon";

type ButtonVariantOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const baseButtonClasses =
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium ring-offset-background transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 aria-[busy=true]:cursor-wait aria-[busy=true]:opacity-80 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0";

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg hover:shadow-xl",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  outline:
    "border border-border bg-background hover:bg-accent hover:text-accent-foreground hover:border-primary/50",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost: "hover:bg-accent hover:text-accent-foreground",
  link: "text-primary underline-offset-4 hover:underline",
};

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-12 min-h-12 px-6 py-3 text-base",
  sm: "h-9 min-h-9 rounded-xl px-3 text-sm",
  lg: "h-14 min-h-14 rounded-2xl px-10 text-lg font-semibold",
  icon: "h-10 min-h-10 w-10 min-w-10",
};

function buttonVariants({
  variant = "default",
  size = "default",
}: ButtonVariantOptions = {}): string {
  return cn(baseButtonClasses, variantClasses[variant], sizeClasses[size]);
}

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button, buttonVariants };
