"use client";

import { ArrowLeft, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GameError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Game page error:", error);
	}, [error]);

	return (
		<main className="min-h-screen flex items-center justify-center p-6">
			<div className="text-center space-y-4 max-w-md">
				<h1 className="font-display text-xl font-bold">Failed to load game</h1>
				<p className="text-sm text-muted-foreground">
					{error.message || "Could not load game data"}
				</p>
				<div className="flex items-center justify-center gap-3 pt-2">
					<Button variant="outline" size="sm" onClick={reset}>
						<RefreshCw className="h-3 w-3 mr-2" />
						Retry
					</Button>
					<Link href="/">
						<Button variant="ghost" size="sm">
							<ArrowLeft className="h-3 w-3 mr-2" />
							Back
						</Button>
					</Link>
				</div>
			</div>
		</main>
	);
}
