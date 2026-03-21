"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

type InviteState =
  | { status: "loading" }
  | { status: "invalid"; reason: "expired" | "used" | "not_found" }
  | { status: "ready"; venueName: string; email: string; isExistingUser: boolean }
  | { status: "accepted" };

export default function InviteAcceptPage() {
  const params = useParams();
  const token = params.token as string;
  const router = useRouter();
  const supabase = createClient();

  const [invite, setInvite] = useState<InviteState>({ status: "loading" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function lookupInvite() {
      // Check if user is already logged in
      const { data: { user } } = await supabase.auth.getUser();

      // Fetch invite from API
      const res = await fetch(`/api/invite/accept?token=${encodeURIComponent(token)}`);
      const data = await res.json();

      if (!res.ok || !data.invite) {
        if (data.reason === "expired") {
          setInvite({ status: "invalid", reason: "expired" });
        } else if (data.reason === "used") {
          setInvite({ status: "invalid", reason: "used" });
        } else {
          setInvite({ status: "invalid", reason: "not_found" });
        }
        return;
      }

      setInvite({
        status: "ready",
        venueName: data.invite.venue_name,
        email: data.invite.email,
        isExistingUser: !!user,
      });
    }

    lookupInvite();
  }, [token]);

  async function handleNewUserSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (invite.status !== "ready") return;

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);

    // Sign up
    const { error: signUpError } = await supabase.auth.signUp({
      email: invite.email,
      password,
    });

    if (signUpError) {
      setError(signUpError.message);
      setSubmitting(false);
      return;
    }

    // Accept invite
    const res = await fetch("/api/invite/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Failed to accept invite.");
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
  }

  async function handleExistingUserAccept() {
    setError(null);
    setSubmitting(true);

    const res = await fetch("/api/invite/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? "Failed to accept invite.");
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
  }

  if (invite.status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading invitation...</p>
      </div>
    );
  }

  if (invite.status === "invalid") {
    const messages: Record<typeof invite.reason, string> = {
      expired: "This invite link has expired or is invalid.",
      used: "This invite has already been used.",
      not_found: "This invite link has expired or is invalid.",
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">Bloom Intelligence</h1>
          <div className="bg-white rounded-lg border border-gray-200 p-6 mt-6">
            <p className="text-sm text-gray-700">{messages[invite.reason]}</p>
            <p className="text-sm text-gray-500 mt-3">
              Contact your venue coordinator to request a new invite.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Bloom Intelligence</h1>
          <p className="text-sm text-gray-500 mt-1">You've been invited</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-700 mb-6">
            You've been invited to join{" "}
            <span className="font-semibold text-gray-900">{invite.venueName}</span> on Bloom
            Intelligence.
          </p>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3 mb-4">
              {error}
            </div>
          )}

          {invite.isExistingUser ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                You're signed in. Click below to accept the invitation and join this venue.
              </p>
              <button
                onClick={handleExistingUserAccept}
                disabled={submitting}
                className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Accepting..." : "Accept invitation"}
              </button>
            </div>
          ) : (
            <form onSubmit={handleNewUserSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={invite.email}
                  readOnly
                  className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Create a password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-blue-600 text-white rounded-md py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Joining..." : "Join venue"}
              </button>

              <p className="text-center text-xs text-gray-500">
                Already have an account?{" "}
                <Link
                  href={`/login?redirect=/invite/${token}`}
                  className="text-blue-600 hover:underline"
                >
                  Sign in first
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
