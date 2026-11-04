import { squareForShop, webhookCredentials } from "@/server/square/client";
import { handleSquareWebhook } from "@/server/square/process-webhook";
import { getStore } from "@/server/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const store = await getStore();
  const creds = webhookCredentials();
  return handleSquareWebhook(request, {
    store,
    signatureKey: creds.key,
    notificationUrl: creds.url,
    gatewayForMerchant: async (merchantId) => {
      const shopId = await store.findShopIdByMerchant(merchantId);
      if (!shopId) return null;
      return squareForShop(store, shopId);
    },
  });
}
