import { squareEnvName } from "@/domain/env";
import { isDemoCipher, planOrderSearches, squareHosts, type SquareEnv } from "@/domain/square";
import type { SquareOrder, SquarePayment } from "@/domain/types";
import { decryptSecret } from "@/domain/webhook";
import type { AppStore } from "@/server/store";

export class SquareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "SquareError";
  }
}

export class HttpSquare {
  constructor(
    private readonly token: string,
    private readonly env: SquareEnv,
    private readonly version = process.env.SQUARE_API_VERSION || "2026-01-22",
  ) {}

  retrieveOrder(orderId: string): Promise<SquareOrder | null> {
    return this.get(`/v2/orders/${orderId}`).then((body) => (body.order as SquareOrder) ?? null);
  }

  retrievePayment(paymentId: string): Promise<SquarePayment | null> {
    return this.get(`/v2/payments/${paymentId}`).then((body) => (body.payment as SquarePayment) ?? null);
  }

  retrieveRefund(refundId: string): Promise<{ id: string; order_id?: string; payment_id?: string } | null> {
    return this.get(`/v2/refunds/${refundId}`).then((body) => (body.refund as { id: string; order_id?: string; payment_id?: string }) ?? null);
  }

  async searchOrders(input: { locationIds: string[]; cursor?: string; startAt?: string; endAt?: string; limit?: number }): Promise<{ orders: SquareOrder[]; cursor?: string }> {
    const body = await this.post("/v2/orders/search", {
      location_ids: input.locationIds,
      cursor: input.cursor,
      limit: input.limit ?? 1000,
      query: {
        filter: {
          state_filter: { states: ["COMPLETED", "OPEN"] },
          ...(input.startAt || input.endAt
            ? { date_time_filter: { closed_at: { start_at: input.startAt, end_at: input.endAt } } }
            : {}),
        },
        sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
      },
    });
    return { orders: (body.orders as SquareOrder[]) ?? [], cursor: body.cursor as string | undefined };
  }

  async searchAllOrders(locationIds: string[], startAt?: string, endAt?: string): Promise<SquareOrder[]> {
    const orders: SquareOrder[] = [];
    for (const call of planOrderSearches(locationIds)) {
      let cursor: string | undefined;
      do {
        const page = await this.searchOrders({ locationIds: call.locationIds, cursor, startAt, endAt, limit: call.limit });
        orders.push(...page.orders);
        cursor = page.cursor;
      } while (cursor);
    }
    return orders;
  }

  listLocations(): Promise<{ id: string; name: string; status?: string }[]> {
    return this.get("/v2/locations").then((body) =>
      ((body.locations as { id: string; name?: string; status?: string }[]) ?? []).map((location) => ({
        id: location.id,
        name: location.name || location.id,
        status: location.status,
      })),
    );
  }

  searchCatalog(cursor?: string): Promise<{ objects: Record<string, unknown>[]; related: Record<string, unknown>[]; cursor?: string }> {
    return this.post("/v2/catalog/search", {
      object_types: ["ITEM", "ITEM_VARIATION", "CATEGORY"],
      include_related_objects: true,
      limit: 100,
      cursor,
    }).then((body) => ({
      objects: (body.objects as Record<string, unknown>[]) ?? [],
      related: (body.related_objects as Record<string, unknown>[]) ?? [],
      cursor: body.cursor as string | undefined,
    }));
  }

  createVendorAttribute(idempotencyKey: string, body: Record<string, unknown>): Promise<{ status: number; body: string; json: Record<string, unknown> }> {
    return this.send("/v2/catalog/custom-attribute-definitions", { method: "POST", json: body, idempotency: idempotencyKey, allowError: true });
  }

  batchUpsert(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.post("/v2/catalog/batch-upsert", body);
  }

  private get(path: string): Promise<Record<string, unknown>> {
    return this.send(path, { method: "GET" }).then((result) => result.json);
  }

  private post(path: string, json: unknown): Promise<Record<string, unknown>> {
    return this.send(path, { method: "POST", json }).then((result) => result.json);
  }

  private async send(path: string, init: { method: string; json?: unknown; idempotency?: string; allowError?: boolean }): Promise<{ status: number; body: string; json: Record<string, unknown> }> {
    const response = await fetch(`${squareHosts(this.env).api}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Square-Version": this.version,
        "Content-Type": "application/json",
      },
      body: init.json == null ? undefined : JSON.stringify(init.json),
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok && !init.allowError) {
      const errors = json.errors as { detail?: string }[] | undefined;
      throw new SquareError(errors?.[0]?.detail || response.statusText, response.status, text);
    }
    return { status: response.status, body: text, json };
  }
}

export function squareAppCredentials(): { env: SquareEnv; applicationId: string; applicationSecret: string; redirectUrl: string } {
  const env = squareEnvName();
  const production = env === "production";
  const applicationId = (production && process.env.SQUARE_PRODUCTION_APPLICATION_ID) || process.env.SQUARE_APPLICATION_ID || "";
  const applicationSecret = (production && process.env.SQUARE_PRODUCTION_APPLICATION_SECRET) || process.env.SQUARE_APPLICATION_SECRET || "";
  const redirectUrl = process.env.SQUARE_OAUTH_REDIRECT_URL || "";
  return { env, applicationId, applicationSecret, redirectUrl };
}

export function webhookCredentials(): { key: string; url: string } {
  const production = squareEnvName() === "production";
  return {
    key: (production && process.env.SQUARE_PRODUCTION_WEBHOOK_SIGNATURE_KEY) || process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "",
    url: (production && process.env.SQUARE_PRODUCTION_WEBHOOK_NOTIFICATION_URL) || process.env.SQUARE_WEBHOOK_NOTIFICATION_URL || "",
  };
}

export async function squareForShop(store: AppStore, shopId: string): Promise<HttpSquare | null> {
  const connection = await store.getConnection(shopId);
  if (!connection || isDemoCipher(connection.accessTokenCipher)) return null;
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is required to read Square tokens.");
  const token = await decryptSecret(connection.accessTokenCipher, key);
  return new HttpSquare(token, connection.sandbox ? "sandbox" : "production");
}

export async function exchangeSquareCode(code: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; merchantId: string }> {
  const creds = squareAppCredentials();
  const response = await fetch(`${squareHosts(creds.env).connect}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": process.env.SQUARE_API_VERSION || "2026-01-22" },
    body: JSON.stringify({
      client_id: creds.applicationId,
      client_secret: creds.applicationSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: creds.redirectUrl,
    }),
  });
  const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_at?: string; merchant_id?: string; message?: string };
  if (!response.ok || !json.access_token || !json.refresh_token || !json.merchant_id) {
    throw new Error(json.message || "Square did not return tokens.");
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresAt: json.expires_at || new Date(Date.now() + 29 * 86400000).toISOString(), merchantId: json.merchant_id };
}

export async function refreshSquareToken(refreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: string }> {
  const creds = squareAppCredentials();
  const response = await fetch(`${squareHosts(creds.env).connect}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Square-Version": process.env.SQUARE_API_VERSION || "2026-01-22" },
    body: JSON.stringify({
      client_id: creds.applicationId,
      client_secret: creds.applicationSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const json = (await response.json()) as { access_token?: string; refresh_token?: string; expires_at?: string; message?: string };
  if (!response.ok || !json.access_token) throw new Error(json.message || "Square token refresh failed.");
  return { accessToken: json.access_token, refreshToken: json.refresh_token || refreshToken, expiresAt: json.expires_at || new Date(Date.now() + 29 * 86400000).toISOString() };
}

export async function revokeSquareToken(accessToken: string): Promise<void> {
  const creds = squareAppCredentials();
  await fetch(`${squareHosts(creds.env).connect}/oauth2/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Client ${creds.applicationSecret}`,
      "Square-Version": process.env.SQUARE_API_VERSION || "2026-01-22",
    },
    body: JSON.stringify({ client_id: creds.applicationId, access_token: accessToken }),
  });
}
