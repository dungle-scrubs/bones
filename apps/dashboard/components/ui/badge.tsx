"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors border",
	{
		variants: {
			variant: {
				default: "border-border bg-secondary text-secondary-foreground",
				valid: "border-valid/40 bg-valid/8 text-valid",
				invalid: "border-invalid/40 bg-invalid/8 text-invalid",
				duplicate: "border-duplicate/40 bg-duplicate/8 text-duplicate",
				pending: "border-border bg-secondary text-muted-foreground",
				active: "border-foreground/20 bg-transparent text-foreground",
				winner: "border-accent/40 bg-accent/8 text-accent",
				eliminated:
					"border-muted-foreground/30 bg-transparent text-muted-foreground line-through",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
);

export interface BadgeProps
	extends React.HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
	return (
		<div className={cn(badgeVariants({ variant }), className)} {...props} />
	);
}
