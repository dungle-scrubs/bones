"use client";

import { useQuery } from "@tanstack/react-query";
import {
	type ColumnDef,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type SortingState,
	useReactTable,
} from "@tanstack/react-table";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	CheckCircle,
	ChevronDown,
	Clock,
	Copy,
	Filter,
	XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
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
}

interface FindingsResponse {
	findings: Finding[];
	timestamp: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8019";

async function fetchFindings(gameId: string): Promise<FindingsResponse> {
	const res = await fetch(`${API_BASE}/api/games/${gameId}/findings`);
	if (!res.ok) throw new Error("Failed to fetch findings");
	return res.json();
}

type FindingStatus = Finding["status"];

const STATUS_CONFIG: Record<
	FindingStatus,
	{
		label: string;
		icon: typeof CheckCircle;
		variant: "valid" | "invalid" | "duplicate" | "pending";
	}
> = {
	valid: { label: "Valid", icon: CheckCircle, variant: "valid" },
	false_flag: { label: "False Flag", icon: XCircle, variant: "invalid" },
	duplicate: { label: "Duplicate", icon: Copy, variant: "duplicate" },
	pending: { label: "Pending", icon: Clock, variant: "pending" },
};

function StatusBadge({ status }: { status: FindingStatus }) {
	const config = STATUS_CONFIG[status];
	const Icon = config.icon;

	return (
		<Badge variant={config.variant} className="gap-1">
			<Icon className="h-3 w-3" />
			{config.label}
		</Badge>
	);
}

function PointsBadge({ points }: { points: number }) {
	if (points === 0) return <span className="text-muted-foreground">-</span>;

	return (
		<span
			className={cn(
				"font-semibold tabular-nums",
				points > 0 ? "text-valid" : "text-invalid",
			)}
		>
			{points > 0 ? "+" : ""}
			{points}
		</span>
	);
}

const CONFIDENCE_CONFIG: Record<
	Confidence,
	{ label: string; className: string }
> = {
	high: { label: "High", className: "bg-valid/20 text-valid border-valid/30" },
	medium: {
		label: "Med",
		className: "bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
	},
	low: {
		label: "Low",
		className: "bg-orange-500/20 text-orange-500 border-orange-500/30",
	},
};

function ConfidenceBadge({ confidence }: { confidence: Confidence | null }) {
	if (!confidence)
		return <span className="text-muted-foreground text-xs">-</span>;

	const config = CONFIDENCE_CONFIG[confidence];
	return (
		<span
			className={cn(
				"text-[10px] px-1.5 py-0.5 border font-medium uppercase tracking-wider",
				config.className,
			)}
		>
			{config.label}
		</span>
	);
}

interface FindingsTableProps {
	gameId: string;
}

export function FindingsTable({ gameId }: FindingsTableProps) {
	const router = useRouter();
	const [sorting, setSorting] = useState<SortingState>([]);
	const [statusFilter, setStatusFilter] = useState<Set<FindingStatus>>(
		new Set(["valid"]),
	);

	const { data, isLoading } = useQuery({
		queryKey: ["findings", gameId],
		queryFn: () => fetchFindings(gameId),
		refetchInterval: 2000,
	});

	const columns = useMemo<ColumnDef<Finding>[]>(
		() => [
			{
				accessorKey: "id",
				header: ({ column }) => (
					<Button
						variant="ghost"
						size="sm"
						className="-ml-3 h-8 data-[state=open]:bg-accent"
						onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
					>
						ID
						{column.getIsSorted() === "asc" ? (
							<ArrowUp className="ml-1 h-3 w-3" />
						) : column.getIsSorted() === "desc" ? (
							<ArrowDown className="ml-1 h-3 w-3" />
						) : (
							<ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
						)}
					</Button>
				),
				cell: ({ row }) => (
					<span className="font-mono text-muted-foreground">
						#{row.original.id}
					</span>
				),
			},
			{
				accessorKey: "status",
				header: "Status",
				cell: ({ row }) => <StatusBadge status={row.original.status} />,
			},
			{
				accessorKey: "confidence",
				header: "Conf",
				cell: ({ row }) => (
					<ConfidenceBadge confidence={row.original.confidence} />
				),
			},
			{
				accessorKey: "agentId",
				header: "Agent",
				cell: ({ row }) => (
					<span className="font-mono text-xs">
						{formatAgentName(row.original.agentId)}
					</span>
				),
			},
			{
				accessorKey: "filePath",
				header: "Location",
				cell: ({ row }) => (
					<div className="max-w-[200px]">
						<span className="font-mono text-xs text-muted-foreground truncate block">
							{row.original.filePath.split("/").slice(-2).join("/")}
						</span>
						<span className="font-mono text-[10px] text-muted-foreground/70">
							L{row.original.lineStart}-{row.original.lineEnd}
						</span>
					</div>
				),
			},
			{
				accessorKey: "description",
				header: "Description",
				cell: ({ row }) => (
					<div
						className="max-w-[300px] truncate"
						title={row.original.description}
					>
						{row.original.description}
					</div>
				),
			},
			{
				accessorKey: "points",
				header: ({ column }) => (
					<Button
						variant="ghost"
						size="sm"
						className="-ml-3 h-8 data-[state=open]:bg-accent"
						onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
					>
						Points
						{column.getIsSorted() === "asc" ? (
							<ArrowUp className="ml-1 h-3 w-3" />
						) : column.getIsSorted() === "desc" ? (
							<ArrowDown className="ml-1 h-3 w-3" />
						) : (
							<ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
						)}
					</Button>
				),
				cell: ({ row }) => <PointsBadge points={row.original.points} />,
			},
			{
				accessorKey: "round",
				header: "Rnd",
				cell: ({ row }) => (
					<span className="text-muted-foreground tabular-nums">
						{row.original.round}
					</span>
				),
			},
		],
		[],
	);

	const filteredData = useMemo(() => {
		if (!data?.findings) return [];
		if (statusFilter.size === 0) return data.findings;
		return data.findings.filter((f) => statusFilter.has(f.status));
	}, [data?.findings, statusFilter]);

	const table = useReactTable({
		data: filteredData,
		columns,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		state: { sorting },
	});

	const toggleStatus = (status: FindingStatus) => {
		setStatusFilter((prev) => {
			const next = new Set(prev);
			if (next.has(status)) {
				next.delete(status);
			} else {
				next.add(status);
			}
			return next;
		});
	};

	const statusCounts = useMemo(() => {
		if (!data?.findings)
			return { valid: 0, false_flag: 0, duplicate: 0, pending: 0 };
		return data.findings.reduce(
			(acc, f) => {
				acc[f.status]++;
				return acc;
			},
			{ valid: 0, false_flag: 0, duplicate: 0, pending: 0 } as Record<
				FindingStatus,
				number
			>,
		);
	}, [data?.findings]);

	if (isLoading) {
		return (
			<div className="border border-border bg-card p-6">
				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
					Loading findings...
				</div>
			</div>
		);
	}

	return (
		<div className="border border-border bg-card">
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-border">
				<div className="flex items-center gap-3">
					<h3 className="font-display text-sm font-semibold uppercase tracking-wider">
						Findings
					</h3>
					<span className="text-xs text-muted-foreground tabular-nums">
						{filteredData.length} / {data?.findings.length ?? 0}
					</span>
				</div>

				{/* Filter dropdown */}
				<DropdownMenu
					trigger={
						<Button variant="outline" size="sm" className="gap-2">
							<Filter className="h-3 w-3" />
							Filter
							{statusFilter.size > 0 && statusFilter.size < 4 && (
								<span className="ml-1 flex h-4 w-4 items-center justify-center bg-primary text-primary-foreground text-[10px]">
									{statusFilter.size}
								</span>
							)}
							<ChevronDown className="h-3 w-3 opacity-50" />
						</Button>
					}
					align="end"
				>
					<DropdownMenuLabel>Filter by status</DropdownMenuLabel>
					<DropdownMenuSeparator />
					{(Object.keys(STATUS_CONFIG) as FindingStatus[]).map((status) => (
						<DropdownMenuCheckboxItem
							key={status}
							checked={statusFilter.has(status)}
							onCheckedChange={() => toggleStatus(status)}
						>
							<span className="flex-1">{STATUS_CONFIG[status].label}</span>
							<span className="text-muted-foreground tabular-nums ml-2">
								{statusCounts[status]}
							</span>
						</DropdownMenuCheckboxItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuCheckboxItem
						checked={statusFilter.size === 4}
						onCheckedChange={() => {
							if (statusFilter.size === 4) {
								setStatusFilter(new Set(["valid"]));
							} else {
								setStatusFilter(
									new Set(["valid", "false_flag", "duplicate", "pending"]),
								);
							}
						}}
					>
						Show all
					</DropdownMenuCheckboxItem>
				</DropdownMenu>
			</div>

			{/* Table */}
			{filteredData.length === 0 ? (
				<div className="px-4 py-8 text-center text-sm text-muted-foreground">
					No findings match the current filter.
				</div>
			) : (
				<div className="max-h-[400px] overflow-auto">
					<Table>
						<TableHeader className="sticky top-0 z-10">
							{table.getHeaderGroups().map((headerGroup) => (
								<TableRow
									key={headerGroup.id}
									className="border-b border-border hover:bg-transparent"
								>
									{headerGroup.headers.map((header) => (
										<TableHead key={header.id}>
											{header.isPlaceholder
												? null
												: flexRender(
														header.column.columnDef.header,
														header.getContext(),
													)}
										</TableHead>
									))}
								</TableRow>
							))}
						</TableHeader>
						<TableBody>
							{table.getRowModel().rows.map((row) => (
								<TableRow
									key={row.id}
									className="cursor-pointer hover:bg-secondary/80"
									onClick={() =>
										router.push(`/game/${gameId}/finding/${row.original.id}`)
									}
								>
									{row.getVisibleCells().map((cell) => (
										<TableCell key={cell.id}>
											{flexRender(
												cell.column.columnDef.cell,
												cell.getContext(),
											)}
										</TableCell>
									))}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
