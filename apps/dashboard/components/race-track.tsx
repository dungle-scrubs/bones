"use client";

import { AnimatePresence } from "framer-motion";
import type { ScoreboardEntry, Phase } from "@/lib/types";
import { AgentCard } from "./agent-card";

interface RaceTrackProps {
  scoreboard: ScoreboardEntry[];
  phase: Phase;
  targetScore: number;
}

export function RaceTrack({ scoreboard, phase, targetScore }: RaceTrackProps) {
  // Sort by score descending (already sorted from API, but ensure)
  const sorted = [...scoreboard].sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-6">
      {/* Progress bar showing distance to target */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>Progress to {targetScore} points</span>
          <span>
            Leader: {sorted[0]?.score ?? 0} / {targetScore}
          </span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-amber-400 transition-all duration-500"
            style={{
              width: `${Math.min(100, ((sorted[0]?.score ?? 0) / targetScore) * 100)}%`,
            }}
          />
        </div>
      </div>

      {/* Agent cards */}
      <div className="space-y-4">
        <AnimatePresence mode="popLayout">
          {sorted.map((agent, index) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              rank={index + 1}
              phase={phase}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
