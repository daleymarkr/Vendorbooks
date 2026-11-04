export function isDemoMode(): boolean {
  if (process.env.DEMO_MODE === "true") return true;
  if (process.env.DEMO_MODE === "false") return false;
  const hasSupabase = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
  if (hasSupabase) return false;
  return process.env.NODE_ENV !== "production";
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function sessionSecret(): string {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET is required in production.");
  }
  return "vendorbooks-dev-session";
}

export function squareEnvName(): "sandbox" | "production" {
  return process.env.SQUARE_ENV === "production" ? "production" : "sandbox";
}

export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
