"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink, TRPCClientError } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { useState } from "react";
import superjson from "superjson";
import { trpc } from "./client";
import { DEMO_COOKIE } from "@/lib/demo";

function getBaseUrl() {
  if (typeof window !== "undefined") return "";
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}

// AI procedures are slow (5-15s) — keep them off the batch so they don't
// block fast data queries from returning.
const AI_PATHS = new Set(["insights.getBriefing", "insights.ask"]);

/** Check if the bloom_demo cookie is present (client-side) */
function isDemoMode(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split(";").some((c) => c.trim().startsWith(`${DEMO_COOKIE}=`));
}

/**
 * tRPC link that intercepts mutation operations in demo mode.
 * Queries and subscriptions pass through; mutations throw a friendly error.
 */
function demoGuardLink<TRouter extends AnyRouter>(): TRPCLink<TRouter> {
  return () => {
    return ({ op, next }) => {
      if (op.type === "mutation" && isDemoMode()) {
        return observable((observer) => {
          observer.error(
            TRPCClientError.from(
              new Error("This is a demo — in your account, you'd be able to edit this."),
            ),
          );
        });
      }
      return next(op);
    };
  };
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        // Block mutations in demo mode before they hit the network
        demoGuardLink(),
        splitLink({
          condition: (op) => AI_PATHS.has(op.path),
          true: httpLink({
            url: `${getBaseUrl()}/api/trpc`,
            transformer: superjson,
          }),
          false: httpBatchLink({
            url: `${getBaseUrl()}/api/trpc`,
            transformer: superjson,
          }),
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
