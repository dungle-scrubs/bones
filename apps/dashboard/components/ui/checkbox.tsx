"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, onCheckedChange, ...props }, ref) => {
    return (
      <div className="relative inline-flex items-center">
        <input
          type="checkbox"
          ref={ref}
          className="sr-only peer"
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          {...props}
        />
        <div
          className={cn(
            "h-4 w-4 shrink-0 border border-border bg-input",
            "peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-primary",
            "peer-checked:bg-primary peer-checked:border-primary",
            "flex items-center justify-center cursor-pointer transition-colors",
            className
          )}
          onClick={() => {
            const input = ref && "current" in ref ? ref.current : null;
            if (input) {
              input.click();
            }
          }}
        >
          <Check className="h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100 transition-opacity" />
        </div>
      </div>
    );
  }
);

Checkbox.displayName = "Checkbox";
