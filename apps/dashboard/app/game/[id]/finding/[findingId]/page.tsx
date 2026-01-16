"use client";

import { useQuery } from "@tanstack/react-query";
import {
	ArrowLeft,
	Calendar,
	CheckCircle,
	Clock,
	Copy,
	FileCode,
	Hash,
	User,
	XCircle,
} from "lucide-react";
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
		description: "This finding has been validated as a legitimate issue.",
	},
	false_flag: {
		label: "False Flag",
		icon: XCircle,
		variant: "invalid",
		description:
			"This finding was determined to be incorrect or not a real issue.",
	},
	duplicate: {
		label: "Duplicate",
		icon: Copy,
		variant: "duplicate",
		description: "This finding duplicates another previously submitted issue.",
	},
	pending: {
		label: "Pending",
		icon: Clock,
		variant: "pending",
		description: "This finding is awaiting review and validation.",
	},
};

const CONFIDENCE_CONFIG: Record<
	Confidence,
	{ label: string; color: string; description: string }
> = {
	high: {
		label: "High Confidence",
		color: "text-valid",
		description: "Strong evidence this is a real, exploitable issue",
	},
	medium: {
		label: "Medium Confidence",
		color: "text-yellow-500",
		description: "Likely a real issue but may require specific conditions",
	},
	low: {
		label: "Low Confidence",
		color: "text-orange-500",
		description: "Possible issue but uncertain or edge case",
	},
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
				<div className="flex flex-col items-center gap-4">
					<div className="h-8 w-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
					<span className="text-sm text-muted-foreground font-mono">
						Loading finding...
					</span>
				</div>
			</main>
		);
	}

	if (isError || !finding) {
		return (
			<main className="min-h-screen flex items-center justify-center p-6">
				<div className="text-center space-y-4 max-w-md">
					<div className="flex items-center justify-center gap-2 text-invalid">
						<XCircle className="h-5 w-5" />
						<span className="font-display text-lg font-semibold uppercase tracking-wider">
							Finding Not Found
						</span>
					</div>
					<p className="text-sm text-muted-foreground font-mono">
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
			<header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
				<div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 pl-14">
					<div className="flex items-center gap-4">
						<Link
							href={`/game/${gameId}`}
							className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
						>
							<ArrowLeft className="h-3 w-3" />
							Back to Game
						</Link>
						<div className="h-4 w-px bg-border" />
						<h1 className="font-display text-sm font-bold uppercase tracking-wider">
							Finding
							<span className="font-mono text-xs text-muted-foreground ml-2 normal-case tracking-normal">
								#{finding.id}
							</span>
						</h1>
					</div>
				</div>
			</header>

			{/* Content */}
			<div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
				{/* Status Card */}
				<div
					className={cn(
						"border p-6 space-y-4",
						finding.status === "valid" && "border-valid/30 bg-valid/5",
						finding.status === "false_flag" && "border-invalid/30 bg-invalid/5",
						finding.status === "duplicate" &&
							"border-duplicate/30 bg-duplicate/5",
						finding.status === "pending" && "border-border bg-card",
					)}
				>
					<div className="flex items-start justify-between gap-4">
						<div className="flex items-center gap-3">
							<StatusIcon
								className={cn(
									"h-6 w-6",
									finding.status === "valid" && "text-valid",
									finding.status === "false_flag" && "text-invalid",
									finding.status === "duplicate" && "text-duplicate",
									finding.status === "pending" && "text-muted-foreground",
								)}
							/>
							<div>
								<Badge variant={statusConfig.variant} className="text-xs">
									{statusConfig.label}
								</Badge>
								<p className="text-xs text-muted-foreground mt-1">
									{statusConfig.description}
								</p>
							</div>
						</div>
						{finding.points !== 0 && (
							<div
								className={cn(
									"font-mono text-2xl font-bold tabular-nums",
									finding.points > 0 ? "text-valid" : "text-invalid",
								)}
							>
								{finding.points > 0 ? "+" : ""}
								{finding.points}
							</div>
						)}
					</div>

					{finding.confidence && (
						<div className="pt-2 border-t border-border/50">
							<span className="text-xs text-muted-foreground">
								Confidence:{" "}
							</span>
							<span
								className={cn(
									"text-xs font-medium",
									CONFIDENCE_CONFIG[finding.confidence].color,
								)}
							>
								{CONFIDENCE_CONFIG[finding.confidence].label}
							</span>
							<p className="text-[10px] text-muted-foreground mt-0.5">
								{CONFIDENCE_CONFIG[finding.confidence].description}
							</p>
						</div>
					)}

					{finding.status === "duplicate" && finding.duplicateOf && (
						<div className="pt-2 border-t border-border/50">
							<span className="text-xs text-muted-foreground">
								Duplicate of:{" "}
							</span>
							<Link
								href={`/game/${gameId}/finding/${finding.duplicateOf}`}
								className="font-mono text-xs text-primary hover:underline"
							>
								#{finding.duplicateOf}
							</Link>
						</div>
					)}

					{finding.status === "false_flag" && finding.invalidReason && (
						<div className="pt-2 border-t border-border/50">
							<span className="text-xs text-muted-foreground">Reason: </span>
							<span className="text-xs">{finding.invalidReason}</span>
						</div>
					)}
				</div>

				{/* Details Grid */}
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
					{/* Metadata */}
					<div className="border border-border bg-card p-4 space-y-3">
						<h3 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
							Metadata
						</h3>
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm">
								<Hash className="h-3.5 w-3.5 text-muted-foreground" />
								<span className="text-muted-foreground">ID:</span>
								<span className="font-mono">{finding.id}</span>
							</div>
							<div className="flex items-center gap-2 text-sm">
								<User className="h-3.5 w-3.5 text-muted-foreground" />
								<span className="text-muted-foreground">Agent:</span>
								<span className="font-mono">
									{formatAgentName(finding.agentId)}
								</span>
							</div>
							<div className="flex items-center gap-2 text-sm">
								<span className="text-muted-foreground ml-5">Round:</span>
								<span className="font-mono">{finding.round}</span>
							</div>
							<div className="flex items-center gap-2 text-sm">
								<Calendar className="h-3.5 w-3.5 text-muted-foreground" />
								<span className="text-muted-foreground">Created:</span>
								<span className="font-mono text-xs">
									{new Date(finding.createdAt).toLocaleString()}
								</span>
							</div>
						</div>
					</div>

					{/* Location */}
					<div className="border border-border bg-card p-4 space-y-3">
						<h3 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
							Location
						</h3>
						<div className="space-y-2">
							<div className="flex items-start gap-2 text-sm">
								<FileCode className="h-3.5 w-3.5 text-muted-foreground mt-0.5" />
								<div className="min-w-0 flex-1">
									<span className="text-muted-foreground">File:</span>
									<div className="font-mono text-xs break-all mt-0.5">
										{finding.filePath}
									</div>
								</div>
							</div>
							<div className="flex items-center gap-2 text-sm ml-5">
								<span className="text-muted-foreground">Lines:</span>
								<span className="font-mono">
									{finding.lineStart} - {finding.lineEnd}
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* Description */}
				<div className="border border-border bg-card p-4 space-y-3">
					<h3 className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
						Description
					</h3>
					<p className="text-sm leading-relaxed whitespace-pre-wrap">
						{finding.description}
					</p>
				</div>
			</div>
		</main>
	);
}
