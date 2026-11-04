import { assertCron } from "@/server/cron";
import { getStore } from "@/server/store";
import { runScheduledClose } from "@/server/workflows";

export async function GET(request: Request) {
  const denied = assertCron(request);
  if (denied) return denied;
  await runScheduledClose(await getStore());
  return Response.json({ ok: true });
}
