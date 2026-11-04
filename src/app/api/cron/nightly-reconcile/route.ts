import { assertCron } from "@/server/cron";
import { getStore } from "@/server/store";
import { reconcileShop } from "@/server/workflows";

export async function GET(request: Request) {
  const denied = assertCron(request);
  if (denied) return denied;
  const store = await getStore();
  for (const shop of await store.listAllShops()) await reconcileShop(store, shop.id);
  return Response.json({ ok: true });
}
