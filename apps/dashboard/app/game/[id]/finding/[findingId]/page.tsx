"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle, Clock, Copy, XCircle } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatAgentName } from "@/lib/utils";

type Confidence = "high" | "medium" | "low";

interface Finding {
	id: number;
	round: number;
	agentId: string;
	description: string;
	filePath: string;
	lineStart: number;
	lineEnd: number;
	status: "pending" | "valid" | "false_flag" | "duplicate";
	confidence: Confidence | null;
	points: number;
	createdAt: string;
	duplicateOf?: number;
	invalidReason?: string;
}

interface FindingsResponse {
	findings: Finding[];
	timestamp: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8019";

async function fetchFinding(
	gameId: string,
	findingId: string,
): Promise<Finding | null> {
	const res = await fetch(`${API_BASE}/api/games/${gameId}/findings`);
	if (!res.ok) throw new Error("Failed to fetch findings");
	const data: FindingsResponse = await res.json();
	return data.findings.find((f) => f.id === parseInt(findingId, 10)) ?? null;
}

type FindingStatus = Finding["status"];

const STATUS_CONFIG: Record<
	FindingStatus,
	{
		label: string;
		icon: typeof CheckCircle;
		variant: "valid" | "invalid" | "duplicate" | "pending";
		description: string;
	}
> = {
	valid: {
		label: "Valid",
		icon: CheckCircle,
		variant: "valid",
		description: "Validated as a legitimate issue.",
	},
	false_flag: {
		label: "False Flag",
		icon: XCircle,
		variant: "invalid",
		description: "Determined to be incorrect or not a real issue.",
	},
	duplicate: {
		label: "Duplicate",
		icon: Copy,
		variant: "duplicate",
		description: "Duplicates a previously submitted issue.",
	},
	pending: {
		label: "Pending",
		icon: Clock,
		variant: "pending",
		description: "Awaiting review and validation.",
	},
};

const CONFIDENCE_CONFIG: Record<Confidence, { label: string; color: string }> =
	{
		high: { label: "High", color: "text-valid" },
		medium: { label: "Medium", color: "text-duplicate" },
		low: { label: "Low", color: "text-invalid" },
	};

export default function FindingDetailPage({
	params,
}: {
	params: Promise<{ id: string; findingId: string }>;
}) {
	const { id: gameId, findingId } = use(params);

	const {
		data: finding,
		isLoading,
		isError,
		error,
	} = useQuery({
		queryKey: ["finding", gameId, findingId],
		queryFn: () => fetchFinding(gameId, findingId),
		staleTime: 10000,
	});

	if (isLoading) {
		return (
			<main className="min-h-screen flex items-center justify-center">
				<p className="text-sm text-muted-foreground">Loading finding…</p>
			</main>
		);
	}

	if (isError || !finding) {
		return (
			<main className="min-h-screen flex items-center justify-center p-6">
				<div className="text-center space-y-4 max-w-md">
					<h1 className="font-display text-xl font-bold">Finding Not Found</h1>
					<p className="text-sm text-muted-foreground">
						{error instanceof Error
							? error.message
							: "Could not load finding details"}
					</p>
					<Link href={`/game/${gameId}`}>
						<Button variant="outline" size="sm">
							<ArrowLeft className="h-3 w-3 mr-2" />
							Back to Game
						</Button>
					</Link>
				</div>
			</main>
		);
	}

	const statusConfig = STATUS_CONFIG[finding.status];
	const StatusIcon = statusConfig.icon;

	return (
		<main className="min-h-screen">
			{/* Header */}
			<header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
				<div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 pl-14">
					<div className="flex items-center gap-3">
						<Link
							href={`/game/${gameId}`}
							className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							<ArrowLeft className="h-3 w-3" />
							Game
						</Link>
						<span className="text-muted-foreground/30">/</span>
						<h1 className="font-display text-sm font-semibold">
							Finding #{finding.id}
						</h1>
					</div>
				</div>
			</header>

			{/* Content */}
			<div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-8">
				{/* Status + Points */}
				<div>
					<div className="flex items-start justify-between gap-4 mb-4">
						<div className="flex items-center gap-3">
							<StatusIcon
								className={cn(
									"h-5 w-5",
									finding.status === "valid" && "text-valid",
									finding.status === "false_flag" && "text-invalid",
									finding.status === "duplicate" && "text-duplicate",
									finding.status === "pending" && "text-muted-foreground",
								)}
							/>
							<div>
								<Badge variant={statusConfig.variant}>
									{statusConfig.label}
								</Badge>
								<p className="text-xs text-muted-foreground mt-1">
									{statusConfig.description}
								</p>
							</div>
						</div>
						{finding.points !== 0 && (
							<span
								className={cn(
									"font-display text-3xl font-bold tabular-nums",
									finding.points > 0 ? "text-valid" : "text-invalid",
								)}
							>
								{finding.points > 0 ? "+" : ""}
								{finding.points}
							</span>
						)}
					</div>

					{finding.confidence && (
						<div className="flex items-baseline gap-2 text-sm">
							<span className="text-muted-foreground">Confidence:</span>
							<span
								className={cn(
									"font-medium",
									CONFIDENCE_CONFIG[finding.confidence].color,
								)}
							>
								{CONFIDENCE_CONFIG[finding.confidence].label}
							</span>
						</div>
					)}

					{finding.status === "duplicate" && finding.duplicateOf && (
						<div className="flex items-baseline gap-2 text-sm mt-2">
							<span className="text-muted-foreground">Duplicate of:</span>
							<Link
								href={`/game/${gameId}/finding/${finding.duplicateOf}`}
								className="font-mono text-primary hover:underline"
							>
								#{finding.duplicateOf}
							</Link>
						</div>
					)}

					{finding.status === "false_flag" && finding.invalidReason && (
						<div className="flex items-baseline gap-2 text-sm mt-2">
							<span className="text-muted-foreground">Reason:</span>
							<span>{finding.invalidReason}</span>
						</div>
					)}

					<div className="editorial-rule mt-6" />
				</div>

				{/* Metadata */}
				<div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
					<div>
						<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">
							Agent
						</span>
						<span className="text-sm font-medium">
							{formatAgentName(finding.agentId)}
						</span>
					</div>
					<div>
						<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">
							Round
						</span>
						<span className="font-mono text-sm">{finding.round}</span>
					</div>
					<div>
						<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">
							Created
						</span>
						<span className="text-sm">
							{new Date(finding.createdAt).toLocaleString()}
						</span>
					</div>
					<div>
						<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-1">
							Finding ID
						</span>
						<span className="font-mono text-sm">#{finding.id}</span>
					</div>
				</div>

				{/* Location */}
				<div>
					<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-2">
						Location
					</span>
					<div className="bg-secondary px-4 py-3">
						<div className="font-mono text-sm break-all">
							{finding.filePath}
						</div>
						<div className="font-mono text-xs text-muted-foreground mt-1">
							Lines {finding.lineStart}–{finding.lineEnd}
						</div>
					</div>
				</div>

				{/* Description */}
				<div>
					<span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium block mb-2">
						Description
					</span>
					<p className="text-sm leading-relaxed whitespace-pre-wrap">
						{finding.description}
					</p>
				</div>
			</div>
		</main>
	);
}
