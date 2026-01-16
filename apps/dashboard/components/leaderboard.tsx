"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePrevious } from "ahooks";
import { Trophy, Target, AlertCircle, Copy, Activity } from "lucide-react";
import { cn, formatAgentName } from "@/lib/utils";
import type { ScoreboardEntry, AgentStatus, Phase } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

interface LeaderboardProps {
  scoreboard: ScoreboardEntry[];
  phase: Phase;
  targetScore: number;
}

function RankBadge({ rank }: { rank: number }) {
  return (
    <div
      className={cn(
        "flex h-6 w-6 items-center justify-center text-xs font-bold tabular-nums shrink-0",
        rank === 1 && "bg-hunt/20 text-hunt border border-hunt/40",
        rank === 2 && "bg-zinc-400/20 text-zinc-400 border border-zinc-400/40",
        rank === 3 && "bg-amber-700/20 text-amber-600 border border-amber-700/40",
        rank > 3 && "bg-secondary text-muted-foreground border border-border"
      )}
    >
      {rank}
    </div>
  );
}

function StatCell({
  icon: Icon,
  value,
  variant,
  label,
}: {
  icon: typeof Target;
  value: number;
  variant?: "valid" | "invalid" | "duplicate";
  label: string;
}) {
  const hasValue = value > 0;
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1 text-xs tabular-nums",
        !hasValue && "text-muted-foreground/50",
        hasValue && variant === "valid" && "text-valid",
        hasValue && variant === "invalid" && "text-invalid",
        hasValue && variant === "duplicate" && "text-duplicate",
        hasValue && !variant && "text-foreground"
      )}
      title={label}
    >
      <Icon className="h-3 w-3" />
      <span className="w-4 text-right">{value}</span>
    </div>
  );
}

function AgentRow({
  agent,
  rank,
  phase,
}: {
  agent: ScoreboardEntry;
  rank: number;
  phase: Phase;
}) {
  const prevScore = usePrevious(agent.score);
  const scoreChanged = prevScore !== undefined && prevScore !== agent.score;
  const isActive = phase === "hunt" || phase === "review" || phase === "hunt_scoring" || phase === "review_scoring";

  return (
    <motion.div
      layout="position"
      layoutId={agent.id}
      initial={false}
      animate={{
        backgroundColor: scoreChanged
          ? ["rgba(100, 200, 220, 0)", "rgba(100, 200, 220, 0.1)", "rgba(100, 200, 220, 0)"]
          : "rgba(100, 200, 220, 0)",
      }}
      transition={{
        layout: { type: "spring", stiffness: 500, damping: 35 },
        backgroundColor: { duration: 0.6 },
      }}
      className={cn(
        "border-b border-border last:border-b-0",
        agent.status === "eliminated" && "opacity-50",
        agent.status === "winner" && "bg-hunt/5"
      )}
    >
      {/* Desktop layout */}
      <div className="hidden sm:grid grid-cols-[40px_minmax(120px,1fr)_64px_64px_64px_64px_80px] items-center gap-3 px-3 py-2.5">
        <RankBadge rank={rank} />

        <div className="flex items-center gap-2 min-w-0">
          <Badge variant={agent.status} className="shrink-0">{agent.status}</Badge>
          <span className="font-mono text-xs text-muted-foreground truncate">
            {formatAgentName(agent.id)}
          </span>
          {isActive && agent.status === "active" && (
            <motion.div
              className="h-1.5 w-1.5 rounded-full bg-valid shrink-0"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
        </div>

        <StatCell icon={Target} value={agent.findingsValid} variant="valid" label="Valid" />
        <StatCell icon={AlertCircle} value={agent.findingsFalse} variant="invalid" label="False" />
        <StatCell icon={Copy} value={agent.findingsDuplicate} variant="duplicate" label="Duplicate" />
        <StatCell icon={Activity} value={agent.findingsSubmitted} label="Total" />

        <motion.div
          className="flex items-center gap-1.5 justify-end"
          animate={scoreChanged ? { scale: [1, 1.1, 1] } : {}}
          transition={{ duration: 0.3 }}
        >
          <Trophy
            className={cn(
              "h-4 w-4",
              agent.status === "winner" ? "text-hunt" : "text-muted-foreground"
            )}
          />
          <span
            className={cn(
              "font-mono text-lg font-bold tabular-nums min-w-[3ch] text-right",
              agent.status === "winner" && "text-hunt text-glow-sm",
              agent.score < 0 && "text-invalid"
            )}
          >
            {agent.score}
          </span>
        </motion.div>
      </div>

      {/* Mobile layout */}
      <div className="sm:hidden px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RankBadge rank={rank} />
            <Badge variant={agent.status}>{agent.status}</Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {formatAgentName(agent.id)}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Trophy className={cn("h-4 w-4", agent.status === "winner" ? "text-hunt" : "text-muted-foreground")} />
            <span className={cn("font-mono text-lg font-bold tabular-nums", agent.score < 0 && "text-invalid")}>
              {agent.score}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="text-valid">V:{agent.findingsValid}</span>
          <span className="text-invalid">F:{agent.findingsFalse}</span>
          <span className="text-duplicate">D:{agent.findingsDuplicate}</span>
          <span>T:{agent.findingsSubmitted}</span>
        </div>
      </div>
    </motion.div>
  );
}

export function Leaderboard({ scoreboard, phase, targetScore }: LeaderboardProps) {
  const sorted = [...scoreboard].sort((a, b) => b.score - a.score);
  const leader = sorted[0];

  return (
    <div className="border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wider">
          Leaderboard
        </h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-muted-foreground">
            Target: <span className="text-foreground font-mono">{targetScore}</span>
          </span>
          <span className="text-muted-foreground">
            Leader: <span className={cn("font-mono", (leader?.score ?? 0) >= targetScore ? "text-hunt" : "text-foreground")}>{leader?.score ?? 0}</span>
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-secondary">
        <motion.div
          className="h-full bg-gradient-to-r from-primary to-hunt"
          initial={false}
          animate={{
            width: `${Math.min(100, Math.max(0, ((leader?.score ?? 0) / targetScore) * 100))}%`,
          }}
          transition={{ duration: 0.5 }}
        />
      </div>

      {/* Column headers - desktop only */}
      <div className="hidden sm:grid grid-cols-[40px_minmax(120px,1fr)_64px_64px_64px_64px_80px] items-center gap-3 px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/50">
        <div>#</div>
        <div>Agent</div>
        <div className="text-center">Valid</div>
        <div className="text-center">False</div>
        <div className="text-center">Dupe</div>
        <div className="text-center">Total</div>
        <div className="text-right">Score</div>
      </div>

      {/* Agents */}
      <AnimatePresence mode="popLayout">
        {sorted.map((agent, index) => (
          <AgentRow key={agent.id} agent={agent} rank={index + 1} phase={phase} />
        ))}
      </AnimatePresence>
    </div>
  );
}
