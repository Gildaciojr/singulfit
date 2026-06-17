import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

interface Feature {
  id: number;
  icon: LucideIcon;
  title: string;
  description: string;
  image?: string;
  video?: string;
}

interface FeaturesAnimatedProps {
  features: Feature[];
  primaryColor?: string;
  progressGradientLight?: string;
  progressGradientDark?: string;
}

export function FeaturesAnimated({
  features,
  primaryColor = "purple-500",
  progressGradientLight = "bg-gradient-to-r from-purple-400 to-purple-500",
  progressGradientDark = "bg-gradient-to-r from-purple-300 to-purple-400",
}: FeaturesAnimatedProps) {
  const [currentFeature, setCurrentFeature] = useState(0);
  const [progress, setProgress] = useState(0);
  const featureRefs = useRef<(HTMLDivElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => (prev >= 100 ? 100 : prev + 1));
    }, 100);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (progress >= 100) {
      setTimeout(() => {
        setCurrentFeature((prev) => (prev + 1) % features.length);
        setProgress(0);
      }, 200);
    }
  }, [progress, features.length]);

  useEffect(() => {
    const activeFeatureElement = featureRefs.current[currentFeature];
    const container = containerRef.current;

    if (activeFeatureElement && container) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = activeFeatureElement.getBoundingClientRect();

      container.scrollTo({
        left:
          activeFeatureElement.offsetLeft -
          (containerRect.width - elementRect.width) / 2,
        behavior: "smooth",
      });
    }
  }, [currentFeature]);

  const handleFeatureClick = (index: number) => {
    setCurrentFeature(index);
    setProgress(0);
  };

  return (
    <div className="min-h-screen py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 lg:gap-16 gap-8 items-center">
          {/* Left Side - Features with Progress Lines */}
          <div
            ref={containerRef}
            className="lg:space-y-8 md:space-x-6 lg:space-x-0 overflow-x-auto overflow-hidden no-scrollbar lg:overflow-visible flex lg:flex lg:flex-col flex-row order-1 pb-4 scroll-smooth"
          >
            {features.map((feature, index) => {
              const Icon = feature.icon;
              const isActive = currentFeature === index;

              return (
                <div
                  key={feature.id}
                  ref={(el) => {
                    featureRefs.current[index] = el;
                  }}
                  className="relative cursor-pointer flex-shrink-0"
                  onClick={() => handleFeatureClick(index)}
                >
                  {/* Feature Content */}
                  <div
                    className={`
                    flex lg:flex-row flex-col items-start space-x-4 p-3 max-w-sm md:max-w-sm lg:max-w-2xl transition-all duration-300
                    ${
                      isActive
                        ? "bg-card md:shadow-xl dark:drop-shadow-lg rounded-xl md:border dark:border-none border-border"
                        : ""
                    }
                  `}
                  >
                    {/* Icon */}
                    <div
                      className={`
                      p-3 hidden md:block rounded-full transition-all duration-300
                      ${
                        isActive
                          ? `bg-primary text-primary-foreground`
                          : `bg-accent text-primary`
                      }
                    `}
                    >
                      <Icon size={24} />
                    </div>

                    {/* Content */}
                    <div className="flex-1">
                      <h3
                        className={`
                        text-lg md:mt-4 lg:mt-0 font-semibold mb-2 transition-colors duration-300
                        ${
                          isActive
                            ? "text-foreground"
                            : "text-foreground/80"
                        }
                      `}
                      >
                        {feature.title}
                      </h3>
                      <p
                        className={`
                        transition-colors duration-300 text-sm
                        ${
                          isActive
                            ? "text-muted-foreground"
                            : "text-muted-foreground/70"
                        }
                      `}
                      >
                        {feature.description}
                      </p>
                      <div className="mt-4 bg-muted rounded-sm h-1 overflow-hidden">
                        {isActive && (
                          <motion.div
                            className={`h-full ${progressGradientLight}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.1, ease: "linear" }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Side - Image/Video Display */}
          <div className="relative order-1 w-full max-w-3xl mx-auto lg:order-2">
            <motion.div
              key={currentFeature}
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -50 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="relative"
            >
              {features[currentFeature].video ? (
                <div className="w-full aspect-video rounded-2xl overflow-hidden shadow-2xl bg-black">
                  <iframe
                    src={features[currentFeature].video}
                    title={features[currentFeature].title}
                    className="w-full h-full"
                    style={{ 
                      display: 'block',
                      width: '100%',
                      height: '100%',
                      border: 'none'
                    }}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  ></iframe>
                </div>
              ) : (
                <img
                  className="rounded-2xl border dark:border-none border-border shadow-lg dark:drop-shadow-lg w-full h-auto"
                  src={features[currentFeature].image}
                  alt={features[currentFeature].title}
                  loading="lazy"
                />
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
