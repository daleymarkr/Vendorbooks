import { chunkIds } from "./money";
import { SQUARE_SCOPES, VENDOR_ATTR_KEY, type SquareOrder } from "./types";

export type SquareEnv = "sandbox" | "production";

export function squareHosts(env: SquareEnv): { connect: string; api: string } {
  if (env === "production") {
    return { connect: "https://connect.squareup.com", api: "https://connect.squareup.com" };
  }
  return { connect: "https://connect.squareupsandbox.com", api: "https://connect.squareupsandbox.com" };
}

export function buildAuthorizeUrl(input: {
  env: SquareEnv;
  applicationId: string;
  redirectUrl: string;
  state: string;
  scopes?: readonly string[];
}): string {
  const url = new URL("/oauth2/authorize", squareHosts(input.env).connect);
  url.searchParams.set("client_id", input.applicationId);
  url.searchParams.set("scope", (input.scopes ?? SQUARE_SCOPES).join(" "));
  url.searchParams.set("session", "false");
  url.searchParams.set("state", input.state);
  url.searchParams.set("redirect_uri", input.redirectUrl);
  return url.toString();
}

export type SearchOrdersCall = {
  locationIds: string[];
  cursor?: string;
  limit: number;
};

/** SearchOrders accepts at most 10 location ids per call and 1000 orders per page. */
export function planOrderSearches(locationIds: string[], limit = 1000): SearchOrdersCall[] {
  const chunks = chunkIds(locationIds.filter(Boolean), 10);
  if (chunks.length === 0) return [];
  return chunks.map((locationIds) => ({ locationIds, limit }));
}

export function vendorAttributeDefinitionBody(idempotencyKey: string): Record<string, unknown> {
  return {
    idempotency_key: idempotencyKey,
    custom_attribute_definition: {
      key: VENDOR_ATTR_KEY,
      name: "Vendor",
      description: "VendorBooks vendor id. Hidden from the Square POS. Used only to attribute sales.",
      type: "STRING",
      visibility: "VISIBILITY_HIDDEN",
    },
  };
}

export function isAttributeLimitError(status: number, body: string): boolean {
  if (status !== 400 && status !== 409 && status !== 422) return false;
  const text = body.toLowerCase();
  return text.includes("limit") || text.includes("maximum") || text.includes("too many") || text.includes("visibility");
}

export type CatalogUpsertObject = {
  type: "ITEM" | "ITEM_VARIATION";
  id: string;
  version?: number | null;
  vendorId: string;
  definitionId?: string;
};

export function batchUpsertVendorAttributes(objects: CatalogUpsertObject[], idempotencyKey: string): Record<string, unknown> {
  return {
    idempotency_key: idempotencyKey,
    batches: [
      {
        objects: objects.map((object) => ({
          type: object.type,
          id: object.id,
          version: object.version ?? undefined,
          custom_attribute_values: {
            [VENDOR_ATTR_KEY]: {
              key: VENDOR_ATTR_KEY,
              string_value: object.vendorId,
              custom_attribute_definition_id: object.definitionId,
            },
          },
        })),
      },
    ],
  };
}

export function orderIdFromWebhook(body: SquareWebhookBody): string | null {
  const obj = body.data?.object ?? {};
  const order = asRecord(obj.order);
  const orderCreated = asRecord(obj.order_created);
  const orderUpdated = asRecord(obj.order_updated);
  const refund = asRecord(obj.refund);
  return (
    stringOf(order?.id) ||
    stringOf(orderCreated?.order_id) ||
    stringOf(orderUpdated?.order_id) ||
    stringOf(obj.order_id) ||
    stringOf(refund?.order_id) ||
    null
  );
}

export function paymentIdFromWebhook(body: SquareWebhookBody): string | null {
  const obj = body.data?.object ?? {};
  const payment = asRecord(obj.payment);
  return stringOf(payment?.id) || stringOf(obj.payment_id);
}

export function refundIdFromWebhook(body: SquareWebhookBody): string | null {
  const obj = body.data?.object ?? {};
  const refund = asRecord(obj.refund);
  return stringOf(refund?.id) || stringOf(obj.refund_id);
}

export type SquareWebhookBody = {
  merchant_id?: string;
  type?: string;
  event_id?: string;
  data?: { type?: string; id?: string; object?: Record<string, unknown> };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

function stringOf(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function shouldIngestOrder(order: SquareOrder): boolean {
  const state = (order.state ?? "COMPLETED").toUpperCase();
  return state === "COMPLETED" || state === "OPEN";
}
