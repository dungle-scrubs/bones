"use client";

import { AlertCircle, Home, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Dashboard error:", error);
	}, [error]);

	return (
		<main className="min-h-screen flex items-center justify-center p-6">
			<div className="text-center space-y-4 max-w-md">
				<div className="flex items-center justify-center gap-2 text-invalid">
					<AlertCircle className="h-6 w-6" />
					<span className="font-display text-xl font-semibold uppercase tracking-wider">
						Application Error
					</span>
				</div>
				<p className="text-sm text-muted-foreground font-mono">
					{error.message || "An unexpected error occurred"}
				</p>
				{error.digest && (
					<p className="text-xs text-muted-foreground/60 font-mono">
						Error ID: {error.digest}
					</p>
				)}
				<div className="flex items-center justify-center gap-3 pt-4">
					<Button variant="outline" size="sm" onClick={reset}>
						<RefreshCw className="h-3 w-3 mr-2" />
						Try again
					</Button>
					<Link href="/">
						<Button variant="ghost" size="sm">
							<Home className="h-3 w-3 mr-2" />
							Home
						</Button>
					</Link>
				</div>
			</div>
		</main>
	);
}
