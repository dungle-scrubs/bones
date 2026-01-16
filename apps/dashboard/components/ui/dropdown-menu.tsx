"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Check, ChevronDown } from "lucide-react";

interface DropdownMenuProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
}

export function DropdownMenu({ trigger, children, align = "start" }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 min-w-[180px] overflow-hidden border border-border bg-popover p-1 shadow-lg shadow-black/20",
            align === "start" && "left-0",
            align === "end" && "right-0",
            align === "center" && "left-1/2 -translate-x-1/2"
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownMenuItemProps {
  children: React.ReactNode;
  onClick?: () => void;
  checked?: boolean;
  disabled?: boolean;
}

export function DropdownMenuItem({ children, onClick, checked, disabled }: DropdownMenuItemProps) {
  return (
    <button
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-xs outline-none transition-colors",
        "hover:bg-secondary focus:bg-secondary",
        disabled && "pointer-events-none opacity-50"
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {checked !== undefined && (
        <div className="h-3.5 w-3.5 flex items-center justify-center">
          {checked && <Check className="h-3 w-3 text-primary" />}
        </div>
      )}
      {children}
    </button>
  );
}

export function DropdownMenuCheckboxItem({
  children,
  checked,
  onCheckedChange,
}: {
  children: React.ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center gap-2 px-2 py-1.5 text-xs outline-none transition-colors",
        "hover:bg-secondary focus:bg-secondary"
      )}
      onClick={() => onCheckedChange(!checked)}
    >
      <div
        className={cn(
          "h-3.5 w-3.5 border flex items-center justify-center transition-colors",
          checked ? "bg-primary border-primary" : "bg-input border-border"
        )}
      >
        {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
      </div>
      {children}
    </button>
  );
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-border" />;
}

export function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}
