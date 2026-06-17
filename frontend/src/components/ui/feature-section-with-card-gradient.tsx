import { useId, useMemo } from "react";
import type { LucideIcon } from "lucide-react";

interface Feature {
  icon: LucideIcon;
  title: string;
  description?: string;
}

interface FeaturesSectionProps {
  features: Feature[];
}

export function FeaturesSectionWithCardGradient({ features }: FeaturesSectionProps) {
  return (
    <div className="py-20 lg:py-32">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 max-w-7xl mx-auto px-4">
        {features.map((feature, index) => (
          <div
            key={index}
            className="relative bg-gradient-to-b from-background to-soft-gray border border-border/50 p-6 rounded-2xl overflow-hidden hover:shadow-lg transition-all duration-300"
          >
            <Grid size={20} />

            <div className="relative z-20">
              <div className="p-3 bg-accent rounded-xl w-fit mb-4">
                <feature.icon className="h-6 w-6 text-primary" />
              </div>

              <p className="text-base font-semibold text-foreground">
                {feature.title}
              </p>

              {feature.description && (
                <p className="text-muted-foreground mt-2 text-sm font-normal">
                  {feature.description}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const Grid = ({
  pattern,
  size,
}: {
  pattern?: number[][];
  size?: number;
}) => {
  const p = useMemo(() => {
    return (
      pattern ?? [
        [7, 2],
        [8, 3],
        [9, 1],
        [10, 5],
        [11, 4],
      ]
    );
  }, [pattern]);

  return (
    <div className="pointer-events-none absolute left-1/2 top-0 -ml-20 -mt-2 h-full w-full [mask-image:linear-gradient(white,transparent)]">
      <div className="absolute inset-0 bg-gradient-to-r [mask-image:radial-gradient(farthest-side_at_top,white,transparent)] from-muted/20 to-muted/10 opacity-100">
        <GridPattern
          width={size ?? 20}
          height={size ?? 20}
          x="-12"
          y="4"
          squares={p}
          className="absolute inset-0 h-full w-full mix-blend-overlay stroke-border/20 fill-border/10"
        />
      </div>
    </div>
  );
};

export function GridPattern({
  width,
  height,
  x,
  y,
  squares,
  className,
  ...props
}: {
  width: number;
  height: number;
  x: string;
  y: string;
  squares: number[][];
  className?: string;
}) {
  const patternId = useId();

  return (
    <svg aria-hidden="true" className={className} {...props}>
      <defs>
        <pattern
          id={patternId}
          width={width}
          height={height}
          patternUnits="userSpaceOnUse"
          x={x}
          y={y}
        >
          <path d={`M.5 ${height}V.5H${width}`} fill="none" />
        </pattern>
      </defs>

      <rect width="100%" height="100%" strokeWidth={0} fill={`url(#${patternId})`} />

      <svg x={x} y={y} className="overflow-visible">
        {squares.map(([sx, sy]) => (
          <rect
            key={`${sx}-${sy}`}
            strokeWidth="0"
            width={width + 1}
            height={height + 1}
            x={sx * width}
            y={sy * height}
          />
        ))}
      </svg>
    </svg>
  );
}
