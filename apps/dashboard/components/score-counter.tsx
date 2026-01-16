"use client";

import { motion, useSpring, useTransform } from "framer-motion";
import { useEffect, useState } from "react";

interface ScoreCounterProps {
  value: number;
  className?: string;
}

export function ScoreCounter({ value, className }: ScoreCounterProps) {
  const [displayValue, setDisplayValue] = useState(value);

  const spring = useSpring(value, {
    stiffness: 100,
    damping: 20,
    mass: 0.5,
  });

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  useEffect(() => {
    const unsubscribe = spring.on("change", (v) => {
      setDisplayValue(Math.round(v));
    });
    return unsubscribe;
  }, [spring]);

  return (
    <motion.span className={className}>
      {displayValue}
    </motion.span>
  );
}
