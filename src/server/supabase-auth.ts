import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL and anon key are required.");
  const jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2] }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // Server Components cannot always set cookies. Middleware refreshes the session.
        }
      },
    },
  });
}
