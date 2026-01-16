"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, Copy, Clock } from "lucide-react";
import { cn, formatAgentName } from "@/lib/utils";

interface Finding {
  id: number;
  round: number;
  agentId: string;
  description: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  status: "pending" | "valid" | "false_flag" | "duplicate";
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

function StatusIcon({ status }: { status: Finding["status"] }) {
  switch (status) {
    case "valid":
      return <CheckCircle className="h-4 w-4 text-emerald-400" />;
    case "false_flag":
      return <XCircle className="h-4 w-4 text-red-400" />;
    case "duplicate":
      return <Copy className="h-4 w-4 text-amber-400" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

interface FindingsListProps {
  gameId: string;
  filter?: "all" | "valid" | "pending";
  title?: string;
}

export function FindingsList({ gameId, filter = "valid", title = "Valid Bugs" }: FindingsListProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["findings", gameId],
    queryFn: () => fetchFindings(gameId),
    refetchInterval: 2000,
  });

  const findings = data?.findings.filter((f) => {
    if (filter === "all") return true;
    if (filter === "valid") return f.status === "valid";
    if (filter === "pending") return f.status === "pending";
    return true;
  }) ?? [];

  if (isLoading) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <div className="text-sm text-muted-foreground">Loading findings...</div>
      </div>
    );
  }

  if (findings.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-4">
        <h3 className="text-sm font-medium mb-2">{title}</h3>
        <div className="text-sm text-muted-foreground">
          {filter === "valid" ? "No validated bugs yet" : "No findings"}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="text-sm font-medium mb-3">{title} ({findings.length})</h3>
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {findings.map((finding) => (
          <div
            key={finding.id}
            className={cn(
              "p-3 rounded-md border text-sm",
              finding.status === "valid" && "border-emerald-500/30 bg-emerald-500/5",
              finding.status === "false_flag" && "border-red-500/30 bg-red-500/5",
              finding.status === "duplicate" && "border-amber-500/30 bg-amber-500/5",
              finding.status === "pending" && "border-border bg-secondary/50"
            )}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <StatusIcon status={finding.status} />
                <span className="font-mono text-xs text-muted-foreground">
                  #{finding.id}
                </span>
                <span className="text-xs text-muted-foreground">
                  by {formatAgentName(finding.agentId)}
                </span>
              </div>
              {finding.points !== 0 && (
                <span
                  className={cn(
                    "text-xs font-medium",
                    finding.points > 0 ? "text-emerald-400" : "text-red-400"
                  )}
                >
                  {finding.points > 0 ? "+" : ""}{finding.points}
                </span>
              )}
            </div>
            <div className="font-mono text-xs text-muted-foreground mb-1">
              {finding.filePath.split("/").slice(-2).join("/")}:{finding.lineStart}-{finding.lineEnd}
            </div>
            <div className="text-foreground line-clamp-2">
              {finding.description}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
