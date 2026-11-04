import { assertCron } from "@/server/cron";
import { getStore } from "@/server/store";
import { sendTrialEmails } from "@/server/workflows";

export async function GET(request: Request) {
  const denied = assertCron(request);
  if (denied) return denied;
  await sendTrialEmails(await getStore());
  return Response.json({ ok: true });
}
