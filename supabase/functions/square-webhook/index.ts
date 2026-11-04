import { handleSquareWebhook } from "../../../src/server/square/process-webhook.ts";
import { squareForShop } from "../../../src/server/square/client.ts";
import { SupabaseStore } from "../../../src/server/store/supabase.ts";

const store = new SupabaseStore(
  Deno.env.get("SUPABASE_URL") ?? Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

Deno.serve((request) =>
  handleSquareWebhook(request, {
    store,
    signatureKey: Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") ?? "",
    notificationUrl: Deno.env.get("SQUARE_WEBHOOK_NOTIFICATION_URL") ?? "",
    gatewayForMerchant: async (merchantId) => {
      const shopId = await store.findShopIdByMerchant(merchantId);
      if (!shopId) return null;
      return squareForShop(store, shopId);
    },
  }),
);
