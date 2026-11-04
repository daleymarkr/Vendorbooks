import "server-only";

import fs from "node:fs";
import path from "node:path";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/demo/ids";
import { buildSeedDump } from "@/demo/seed";
import { timingSafeEqualString } from "@/domain/webhook";
import { MemoryStore } from "./memory";
import type { AppStore, StoreDump } from "./types";

const VERSION = 1;
const FILE = path.join(process.cwd(), ".data", "demo-db.json");

type Persisted = { version: number; dump: StoreDump; passwords: Record<string, string> };

const globalStore = globalThis as unknown as {
  __vendorbooks?: { store: MemoryStore; passwords: Record<string, string> };
};

const MUTATIONS = new Set([
  "upsertUser",
  "createShop",
  "updateShop",
  "updateSettings",
  "upsertConnection",
  "addLocation",
  "saveLocations",
  "createVendor",
  "updateVendor",
  "upsertPortal",
  "upsertCatalogItems",
  "upsertCatalogAttr",
  "createRule",
  "deleteRule",
  "upsertLedgerLines",
  "updateLedgerLine",
  "ensureUnassigned",
  "resolveUnassigned",
  "upsertStatement",
  "updateStatement",
  "insertWebhookEvent",
  "markWebhook",
  "addReconcileRun",
  "addBackfillRun",
  "updateBackfillRun",
  "audit",
  "logEmail",
  "deleteSellerSquareData",
]);

async function hashPassword(userId: string, password: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`vendorbooks:${userId}:${password}`));
  return Buffer.from(digest).toString("base64url");
}

function persist(): void {
  const state = globalStore.__vendorbooks;
  if (!state) return;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const body: Persisted = { version: VERSION, dump: state.store.dump(), passwords: state.passwords };
  fs.writeFileSync(FILE, JSON.stringify(body));
}

async function seedPasswords(): Promise<Record<string, string>> {
  const passwords: Record<string, string> = {};
  for (const account of DEMO_ACCOUNTS) {
    passwords[account.id] = await hashPassword(account.id, DEMO_PASSWORD);
  }
  return passwords;
}

async function loadState(): Promise<void> {
  if (globalStore.__vendorbooks) return;
  let dump = buildSeedDump();
  let passwords = await seedPasswords();
  if (fs.existsSync(FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) as Persisted;
      if (parsed.version === VERSION && parsed.dump?.shops?.length) {
        dump = parsed.dump;
        passwords = { ...passwords, ...parsed.passwords };
      }
    } catch {
      dump = buildSeedDump();
    }
  }
  globalStore.__vendorbooks = { store: new MemoryStore(dump), passwords };
  persist();
}

export async function getDemoStore(): Promise<AppStore> {
  await loadState();
  const state = globalStore.__vendorbooks!;
  return new Proxy(state.store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (typeof prop === "string" && MUTATIONS.has(prop)) {
        return async (...args: unknown[]) => {
          const result = await (value as (...inner: unknown[]) => Promise<unknown>).apply(target, args);
          persist();
          return result;
        };
      }
      return (value as (...inner: unknown[]) => unknown).bind(target);
    },
  }) as AppStore;
}

export async function checkDemoPassword(userId: string, password: string): Promise<boolean> {
  await loadState();
  const expected = globalStore.__vendorbooks?.passwords[userId];
  if (!expected) return false;
  const actual = await hashPassword(userId, password);
  return timingSafeEqualString(actual, expected);
}

export async function setDemoPassword(userId: string, password: string): Promise<void> {
  await loadState();
  globalStore.__vendorbooks!.passwords[userId] = await hashPassword(userId, password);
  persist();
}

export async function resetDemo(): Promise<void> {
  globalStore.__vendorbooks = { store: new MemoryStore(buildSeedDump()), passwords: await seedPasswords() };
  persist();
}
