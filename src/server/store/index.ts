import "server-only";

import { isDemoMode } from "@/domain/env";
import { getDemoStore } from "./demo";
import { SupabaseStore } from "./supabase";
import type { AppStore } from "./types";

export async function getStore(): Promise<AppStore> {
  if (isDemoMode()) return getDemoStore();
  return new SupabaseStore();
}

export type { AppStore } from "./types";
