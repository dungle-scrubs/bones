# Code Hunt Roadmap

## Live Dashboard

Real-time race visualization showing agent positions and score updates.

### Requirements

- Next.js 15 app router
- Tailwind CSS v4
- shadcn/ui components
- Dark mode only
- TanStack Query for data fetching
- ahooks for React utilities (useInterval, useBoolean, etc.)
- Framer Motion for position animations

### Features

1. **Race Track View**
   - Vertical leaderboard with agent cards
   - Cards animate up/down on position changes (spring animation)
   - Score displayed prominently
   - Visual indicator for current phase (hunt/review/scoring)

2. **Agent Cards**
   - Agent ID
   - Current score (animated counter)
   - Stats breakdown (valid/false/duplicate findings, disputes won/lost)
   - Status indicator (active/hunting/reviewing/eliminated/winner)
   - Subtle glow effect on score change

3. **Game Status Bar**
   - Current phase with progress indicator
   - Round number
   - Time remaining (countdown for timed phases)
   - Target score

4. **Activity Feed** (optional)
   - Recent events (finding submitted, dispute filed, validation result)
   - Scrolling log with timestamps

### Data Flow

```
SQLite DB ← CLI writes game state
    ↓
HTTP API ← Lightweight Express/Hono server (add to CLI)
    ↓
TanStack Query ← Polls every 1s during active phases
    ↓
React State → Framer Motion animations
```

### API Endpoints

Add to CLI:

```typescript
// GET /api/games/:id
// Returns game state + scoreboard

// GET /api/games/:id/events?since=<timestamp>
// Returns recent events for activity feed (optional)
```

### Animation Approach

```tsx
// Use layoutId for automatic position animations
<AnimatePresence>
  {scoreboard.map((agent, index) => (
    <motion.div
      key={agent.id}
      layoutId={agent.id}
      layout="position"
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
    >
      <AgentCard agent={agent} rank={index + 1} />
    </motion.div>
  ))}
</AnimatePresence>
```

### File Structure

```
apps/dashboard/
├── app/
│   ├── layout.tsx
│   ├── page.tsx              # Game selector or redirect
│   └── game/[id]/
│       └── page.tsx          # Main dashboard
├── components/
│   ├── race-track.tsx        # Main leaderboard
│   ├── agent-card.tsx        # Individual agent display
│   ├── game-status.tsx       # Phase/round/timer bar
│   ├── score-counter.tsx     # Animated number
│   └── activity-feed.tsx     # Event log
├── lib/
│   ├── api.ts                # TanStack Query hooks
│   └── types.ts              # Shared types from CLI
└── tailwind.config.ts
```

### Why Not Convex

- Game is local-first CLI tool
- Updates happen at discrete moments, not continuous
- Polling at 1s interval is indistinguishable from real-time for this UX
- No deployment/hosting complexity
- SQLite file can be read directly or via HTTP endpoint
- If push updates needed later, SSE is trivial to add

### Implementation Order

1. Add HTTP server to CLI (minimal Express/Hono)
2. Create Next.js app with TanStack Query setup
3. Build static AgentCard and RaceTrack components
4. Add polling and verify data flow
5. Implement Framer Motion animations
6. Polish: score counter animation, phase transitions, activity feed
