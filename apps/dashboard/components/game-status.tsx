"use client";

import { useInterval } from "ahooks";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Clock, Target, Trophy, Search, MessageSquare, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GameState, GameStats, Phase } from "@/lib/types";
import { PHASE_CONFIG } from "@/lib/types";
import { Badge } from "@/components/ui/badge";

interface GameStatusProps {
  game: GameState;
  stats: GameStats;
}

function formatTime(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function PhaseIndicator({ phase }: { phase: Phase }) {
  const phases: Phase[] = ["hunt", "hunt_scoring", "review", "review_scoring"];
  const currentIndex = phases.indexOf(phase);

  return (
    <div className="flex items-center gap-1">
      {phases.map((p, i) => {
        const isActive = p === phase;
        const isPast = currentIndex > i;
        const phaseConfig = PHASE_CONFIG[p];

        return (
          <div key={p} className="flex items-center">
            <div
              className={cn(
                "relative px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-all",
                isActive && "text-background",
                isPast && "text-muted-foreground",
                !isActive && !isPast && "text-muted-foreground/40"
              )}
              style={{
                backgroundColor: isActive ? `var(--color-${p.replace("_", "-")})` : "transparent",
              }}
            >
              {isActive && (
                <motion.div
                  className="absolute inset-0"
                  style={{ backgroundColor: `var(--color-${p.replace("_", "-")})` }}
                  animate={{ opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              )}
              <span className="relative z-10">{phaseConfig.label}</span>
            </div>
            {i < phases.length - 1 && (
              <div
                className={cn(
                  "w-3 h-[2px]",
                  isPast ? "bg-muted-foreground" : "bg-border"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function TotalTimer({ createdAt, completedAt }: { createdAt: string; completedAt: string | null }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(createdAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    setElapsed(Math.floor((end - start) / 1000));
  }, [createdAt, completedAt]);

  useInterval(
    () => {
      const start = new Date(createdAt).getTime();
      setElapsed(Math.floor((Date.now() - start) / 1000));
    },
    completedAt ? undefined : 1000
  );

  return (
    <span className="font-mono text-sm tabular-nums text-muted-foreground">
      {formatDuration(elapsed)}
    </span>
  );
}

function Timer({ endTime, duration }: { endTime: string | null; duration: number }) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!endTime) {
      setRemaining(0);
      return;
    }
    const end = new Date(endTime).getTime();
    setRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)));
  }, [endTime]);

  useInterval(
    () => {
      if (!endTime) return;
      const end = new Date(endTime).getTime();
      setRemaining(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    },
    endTime ? 1000 : undefined
  );

  if (!endTime) {
    return <span className="text-muted-foreground text-sm font-mono">--:--</span>;
  }

  const progress = duration > 0 ? (remaining / duration) * 100 : 0;
  const isUrgent = remaining <= 30;
  const isCritical = remaining <= 10;

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-24 h-1.5 bg-secondary overflow-hidden">
        <motion.div
          className={cn(
            "absolute inset-y-0 left-0 transition-colors",
            isCritical ? "bg-invalid" : isUrgent ? "bg-duplicate" : "bg-primary"
          )}
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
        {isUrgent && (
          <motion.div
            className="absolute inset-0 bg-invalid/50"
            animate={{ opacity: [0, 0.5, 0] }}
            transition={{ duration: 0.5, repeat: Infinity }}
          />
        )}
      </div>
      <motion.span
        className={cn(
          "font-mono text-lg tabular-nums font-semibold",
          isCritical && "text-invalid text-glow-sm",
          isUrgent && !isCritical && "text-duplicate"
        )}
        animate={isCritical ? { scale: [1, 1.05, 1] } : {}}
        transition={{ duration: 0.5, repeat: isCritical ? Infinity : 0 }}
      >
        {formatTime(remaining)}
      </motion.span>
    </div>
  );
}

function StatBlock({
  icon: Icon,
  label,
  value,
  pending,
  highlight,
}: {
  icon: typeof Target;
  label: string;
  value: string | number;
  pending?: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("h-3.5 w-3.5", highlight ? "text-hunt" : "text-muted-foreground")} />
      <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{label}</span>
      <span className={cn("font-mono text-sm font-semibold tabular-nums", highlight && "text-hunt")}>
        {value}
      </span>
      {pending !== undefined && pending > 0 && (
        <span className="text-[10px] text-duplicate font-mono">+{pending}</span>
      )}
    </div>
  );
}

export function GameStatus({ game, stats }: GameStatusProps) {
  const config = PHASE_CONFIG[game.phase];
  const isTimedPhase = game.phase === "hunt" || game.phase === "review";
  const duration = game.phase === "hunt" ? game.huntDuration : game.reviewDuration;

  return (
    <div className="border border-border bg-card">
      {/* Top section - Phase and Timer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-4">
          {/* Round indicator */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Round</span>
            <span className="font-display text-2xl font-bold text-primary tabular-nums">
              {game.round}
            </span>
          </div>

          <div className="w-px h-6 bg-border" />

          {/* Phase */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground">{config.description}</span>
            <PhaseIndicator phase={game.phase} />
          </div>
        </div>

        {/* Timers */}
        <div className="flex items-center gap-4">
          {/* Total elapsed time */}
          <div className="flex items-center gap-1.5">
            <Zap className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</span>
            <TotalTimer createdAt={game.createdAt} completedAt={game.completedAt} />
          </div>

          <div className="w-px h-4 bg-border" />

          {/* Phase countdown */}
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            {isTimedPhase ? (
              <Timer endTime={game.phaseEndsAt} duration={duration} />
            ) : (
              <span className="text-sm text-muted-foreground font-mono">
                {game.isComplete ? "Complete" : "Waiting..."}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bottom section - Stats */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
        <StatBlock icon={Target} label="Target" value={game.targetScore} />
        <StatBlock
          icon={Search}
          label="Findings"
          value={`${stats.validFindings}/${stats.totalFindings}`}
          pending={stats.pendingFindings}
        />
        <StatBlock
          icon={MessageSquare}
          label="Disputes"
          value={stats.totalDisputes}
          pending={stats.pendingDisputes}
        />
        {game.winner && (
          <div className="flex items-center gap-2 ml-auto">
            <Trophy className="h-4 w-4 text-hunt" />
            <span className="text-xs text-hunt font-semibold uppercase tracking-wider">Winner</span>
            <span className="font-mono text-sm text-hunt">{game.winner.split("-").pop()}</span>
          </div>
        )}
      </div>
    </div>
  );
}
