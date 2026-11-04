import { isDemoMode } from "@/domain/env";

export function GET() {
  return Response.json({ ok: true, demo: isDemoMode() });
}
