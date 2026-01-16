"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex items-center px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition-colors",
	{
		variants: {
			variant: {
				default: "border border-border bg-secondary text-secondary-foreground",
				valid: "border border-valid/30 bg-valid/10 text-valid",
				invalid: "border border-invalid/30 bg-invalid/10 text-invalid",
				duplicate: "border border-duplicate/30 bg-duplicate/10 text-duplicate",
				pending: "border border-border bg-secondary text-muted-foreground",
				active: "border border-primary/30 bg-primary/10 text-primary",
				winner: "border border-hunt/30 bg-hunt/10 text-hunt",
				eliminated: "border border-invalid/30 bg-invalid/10 text-invalid",
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
