/**
 * Demo session management.
 *
 * A demo session is stored in a cookie (`bloom_demo`) containing:
 *   { role, venueId, orgId, consultantId, sessionId, expiresAt }
 *
 * When active, the middleware and tRPC context bypass Supabase auth
 * and inject demo-specific venueId/role. All mutations are blocked.
 */

// ── Demo IDs (must match generate-demo.ts) ──────────────────────────────

export const DEMO_ORG_ID = "de000000-0000-0000-0000-000000000001";

export const DEMO_VENUES = {
  stonehill:   "de000000-0000-0000-0000-000000000010",
  lakeview:    "de000000-0000-0000-0000-000000000020",
  marchetti:   "de000000-0000-0000-0000-000000000030",
  cooperfield: "de000000-0000-0000-0000-000000000040",
} as const;

export const DEMO_USERS = {
  owner:  "de000000-0000-0000-0000-a00000000001",
  dana:   "de000000-0000-0000-0000-a00000000002",
  marcus: "de000000-0000-0000-0000-a00000000003",
  priya:  "de000000-0000-0000-0000-a00000000004",
  jordan: "de000000-0000-0000-0000-a00000000005",
} as const;

export const DEMO_COOKIE = "bloom_demo";
export const DEMO_SESSION_DURATION_MS = 60 * 60 * 1000; // 60 minutes

// ── Types ────────────────────────────────────────────────────────────────

export type DemoRole = "owner" | "manager" | "coordinator";

export interface DemoSession {
  role: DemoRole;
  venueId: string;
  orgId: string;
  consultantId: string | null;
  consultantName: string | null;
  sessionId: string;   // references demo_sessions table
  expiresAt: number;   // epoch ms
}

// ── Role → default context mapping ──────────────────────────────────────

export const DEMO_ROLE_DEFAULTS: Record<DemoRole, {
  venueId: string;
  venueRole: string;       // maps to ROLE_HIERARCHY
  consultantId: string | null;
  consultantName: string | null;
  label: string;
  description: string;
}> = {
  owner: {
    venueId: DEMO_VENUES.stonehill,
    venueRole: "enterprise_owner",
    consultantId: null,
    consultantName: null,
    label: "I run a venue group",
    description: "Portfolio view across all 4 venues, comparative analytics, P&L rollup, benchmarking",
  },
  manager: {
    venueId: DEMO_VENUES.stonehill,
    venueRole: "venue_admin",
    consultantId: null,
    consultantName: null,
    label: "I manage a venue",
    description: "Single-venue deep dive — pipeline, analytics, reviews, team performance",
  },
  coordinator: {
    venueId: DEMO_VENUES.stonehill,
    venueRole: "coordinator",
    consultantId: DEMO_USERS.dana,
    consultantName: "Dana Okafor",
    label: "I book weddings",
    description: "Personal pipeline, response metrics, upcoming tours, tasks",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────

export function isDemoPath(pathname: string): boolean {
  return pathname === "/demo" || pathname.startsWith("/demo/");
}

export function parseDemoCookie(raw: string | undefined): DemoSession | null {
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as DemoSession;
    if (!session.role || !session.venueId || !session.expiresAt) return null;
    if (Date.now() > session.expiresAt) return null; // expired
    return session;
  } catch {
    return null;
  }
}

export function createDemoSessionPayload(role: DemoRole, sessionId: string): DemoSession {
  const defaults = DEMO_ROLE_DEFAULTS[role];
  return {
    role,
    venueId: defaults.venueId,
    orgId: DEMO_ORG_ID,
    consultantId: defaults.consultantId,
    consultantName: defaults.consultantName,
    sessionId,
    expiresAt: Date.now() + DEMO_SESSION_DURATION_MS,
  };
}

/** All demo venue IDs — used to check if a venueId belongs to the demo */
export const ALL_DEMO_VENUE_IDS = new Set<string>(Object.values(DEMO_VENUES));

export function isDemoVenue(venueId: string): boolean {
  return ALL_DEMO_VENUE_IDS.has(venueId);
}
