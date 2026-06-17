"use client";

import { useEffect, useState } from "react";

export default function LiveCounter() {
  const [count, setCount] = useState(127);

  useEffect(() => {
    const interval = setInterval(() => {
      setCount((prev) => prev + Math.floor(Math.random() * 3));
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="text-xs text-purple-600 font-medium">
      🔥 {count} pessoas acessando agora
    </div>
  );
}