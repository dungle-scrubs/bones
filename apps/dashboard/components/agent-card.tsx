"use client";

import { motion } from "framer-motion";
import { usePrevious } from "ahooks";
import { Trophy, Target, AlertCircle, Copy, Swords, Shield } from "lucide-react";
import { cn, formatAgentName } from "@/lib/utils";
import type { ScoreboardEntry, AgentStatus, Phase } from "@/lib/types";
import { ScoreCounter } from "./score-counter";

interface AgentCardProps {
  agent: ScoreboardEntry;
  rank: number;
  phase: Phase;
}

function StatusBadge({ status }: { status: AgentStatus }) {
  const config: Record<AgentStatus, { label: string; className: string }> = {
    active: {
      label: "Active",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    },
    eliminated: {
      label: "Eliminated",
      className: "bg-red-500/20 text-red-400 border-red-500/30",
    },
    winner: {
      label: "Winner",
      className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    },
  };

  const { label, className } = config[status];

  return (
    <span
      className={cn(
        "px-2 py-0.5 text-xs font-medium rounded-full border",
        className
      )}
    >
      {label}
    </span>
  );
}

function StatItem({
  icon: Icon,
  value,
  label,
  positive,
}: {
  icon: typeof Trophy;
  value: number;
  label: string;
  positive?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon
        className={cn(
          "h-3.5 w-3.5",
          positive === true && "text-emerald-400",
          positive === false && "text-red-400",
          positive === undefined && "text-muted-foreground"
        )}
      />
      <span className="text-muted-foreground">{label}:</span>
      <span
        className={cn(
          "font-medium",
          positive === true && "text-emerald-400",
          positive === false && "text-red-400"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function AgentCard({ agent, rank, phase }: AgentCardProps) {
  const prevScore = usePrevious(agent.score);
  const scoreChanged = prevScore !== undefined && prevScore !== agent.score;

  const isActive =
    phase === "hunt" || phase === "review" || phase === "hunt_scoring" || phase === "review_scoring";

  return (
    <motion.div
      layout="position"
      layoutId={agent.id}
      initial={false}
      animate={{
        scale: scoreChanged ? [1, 1.02, 1] : 1,
        boxShadow: scoreChanged
          ? [
              "0 0 0 0 rgba(251, 191, 36, 0)",
              "0 0 20px 4px rgba(251, 191, 36, 0.4)",
              "0 0 0 0 rgba(251, 191, 36, 0)",
            ]
          : "0 0 0 0 rgba(251, 191, 36, 0)",
      }}
      transition={{
        layout: { type: "spring", stiffness: 500, damping: 30 },
        scale: { duration: 0.3 },
        boxShadow: { duration: 0.6 },
      }}
      className={cn(
        "relative rounded-lg border bg-card p-4",
        agent.status === "winner" && "border-amber-500/50",
        agent.status === "eliminated" && "opacity-60"
      )}
    >
      {/* Rank badge */}
      <div
        className={cn(
          "absolute -left-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold",
          rank === 1 && "border-amber-500 bg-amber-500/20 text-amber-400",
          rank === 2 && "border-zinc-400 bg-zinc-400/20 text-zinc-300",
          rank === 3 && "border-amber-700 bg-amber-700/20 text-amber-600",
          rank > 3 && "border-border bg-secondary text-muted-foreground"
        )}
      >
        {rank}
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">
            {formatAgentName(agent.id)}
          </span>
          <StatusBadge status={agent.status} />
        </div>
        <div className="flex items-center gap-1">
          <Trophy
            className={cn(
              "h-5 w-5",
              agent.status === "winner" ? "text-amber-400" : "text-muted-foreground"
            )}
          />
          <ScoreCounter
            value={agent.score}
            className="text-lg font-bold tabular-nums"
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        <StatItem
          icon={Target}
          value={agent.findingsValid}
          label="Valid"
          positive={agent.findingsValid > 0}
        />
        <StatItem
          icon={AlertCircle}
          value={agent.findingsFalse}
          label="False"
          positive={agent.findingsFalse === 0}
        />
        <StatItem
          icon={Copy}
          value={agent.findingsDuplicate}
          label="Dupe"
          positive={agent.findingsDuplicate === 0}
        />
        <StatItem
          icon={Swords}
          value={agent.disputesWon}
          label="Won"
          positive={agent.disputesWon > 0}
        />
        <StatItem
          icon={Shield}
          value={agent.disputesLost}
          label="Lost"
          positive={agent.disputesLost === 0}
        />
        <StatItem
          icon={Target}
          value={agent.findingsSubmitted}
          label="Total"
        />
      </div>

      {/* Activity indicator */}
      {isActive && agent.status === "active" && (
        <motion.div
          className="absolute right-3 top-3 h-2 w-2 rounded-full bg-emerald-500"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}
    </motion.div>
  );
}
