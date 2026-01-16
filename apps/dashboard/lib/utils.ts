import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format agent ID "abc123-atlas" -> "Atlas" */
export function formatAgentName(id: string): string {
  const parts = id.split("-");
  const name = parts[parts.length - 1];
  return name.charAt(0).toUpperCase() + name.slice(1);
}
