import { ingestOrder } from "@/domain/ingest";
import { defaultSettings } from "@/domain/payout";
import { computeStatementMath } from "@/domain/statements";
import { SQUARE_SCOPES, type CatalogAttr, type CatalogItem } from "@/domain/types";
import type { StoreDump } from "@/server/store/types";
import { DEMO } from "./ids";

const NOW = "2026-11-04T15:00:00.000Z";

export function buildSeedDump(): StoreDump {
  const settings = defaultSettings(DEMO.shop, "2026-09-01T00:00:00.000Z");
  const alice = {
    id: DEMO.alice,
    shopId: DEMO.shop,
    displayName: "Alice Hart",
    email: "alice@vendors.demo",
    phone: "555-0101",
    commissionBps: 6000,
    boothRentCents: 0,
    payoutMethod: "check" as const,
    payoutDetails: "Mail to booth 12",
    payoutDay: 5,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
  const bob = {
    id: DEMO.bob,
    shopId: DEMO.shop,
    displayName: "Bob Keene",
    email: "bob@vendors.demo",
    phone: "555-0102",
    commissionBps: 5000,
    boothRentCents: 7500,
    payoutMethod: "zelle" as const,
    payoutDetails: "bob@vendors.demo",
    payoutDay: 5,
    archivedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };
  const carol = {
    id: DEMO.carol,
    shopId: DEMO.shop,
    displayName: "Carol Diaz",
    email: "carol@vendors.demo",
    phone: "555-0108",
    commissionBps: 7000,
    boothRentCents: 0,
    payoutMethod: "ach" as const,
    payoutDetails: "On file with the shop",
    payoutDay: 10,
    archivedAt: null,
    createdAt: "2026-09-02T00:00:00.000Z",
  };
  const vendors = [alice, bob, carol];
  const items: CatalogItem[] = [
    item("ITEM_VASE", "ITEM", null, "Milk glass vase", null, "Glass"),
    item("VAR_VASE", "ITEM_VARIATION", "ITEM_VASE", "Milk glass vase", "AL-100", "Glass"),
    item("ITEM_LAMP", "ITEM", null, "Brass lamp", null, "Lighting"),
    item("VAR_LAMP", "ITEM_VARIATION", "ITEM_LAMP", "Brass lamp", "BK-20", "Lighting"),
    item("ITEM_QUILT", "ITEM", null, "Log cabin quilt", null, "Textiles"),
    item("VAR_QUILT", "ITEM_VARIATION", "ITEM_QUILT", "Log cabin quilt", "CD-7", "Textiles"),
    item("ITEM_MISC", "ITEM", null, "Mystery box", null, "Misc"),
    item("VAR_MISC", "ITEM_VARIATION", "ITEM_MISC", "Mystery box", "MISC-1", "Misc"),
  ];
  const attrs: CatalogAttr[] = [
    {
      shopId: DEMO.shop,
      catalogObjectId: "VAR_VASE",
      catalogVersion: 3,
      vendorId: DEMO.alice,
      vendorAttrValue: DEMO.alice,
      source: "square_attr",
      updatedAt: NOW,
    },
    {
      shopId: DEMO.shop,
      catalogObjectId: "ITEM_LAMP",
      catalogVersion: 2,
      vendorId: DEMO.bob,
      vendorAttrValue: DEMO.bob,
      source: "square_attr",
      updatedAt: NOW,
    },
  ];
  const rules = [
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
      shopId: DEMO.shop,
      priority: 10,
      ruleType: "sku_prefix" as const,
      pattern: "AL-",
      vendorId: DEMO.alice,
      active: true,
    },
    {
      id: "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
      shopId: DEMO.shop,
      priority: 20,
      ruleType: "category" as const,
      pattern: "Textiles",
      vendorId: DEMO.carol,
      active: true,
    },
  ];
  const catalog = { items, attrs, rules, vendors };
  const baseCtx = {
    shopId: DEMO.shop,
    timezone: "America/New_York",
    settings,
    locationIdBySquareId: { LOC_MAIN: DEMO.main, LOC_ANNEX: DEMO.annex },
    catalog,
    priorLines: [],
    statementStatus: {},
    closedPeriods: {},
    payments: [],
    nowIso: NOW,
  };

  const aliceOct = ingestOrder(
    {
      id: "ORD_OCT_ALICE",
      location_id: "LOC_MAIN",
      state: "COMPLETED",
      closed_at: "2026-10-15T16:00:00.000Z",
      total_money: { amount: 10800, currency: "USD" },
      line_items: [
        {
          uid: "vase",
          name: "Milk glass vase",
          quantity: "1",
          item_type: "ITEM",
          catalog_object_id: "VAR_VASE",
          gross_sales_money: { amount: 10000, currency: "USD" },
          total_tax_money: { amount: 800, currency: "USD" },
        },
      ],
      tenders: [{ payment_id: "PAY_OCT_ALICE" }],
    },
    {
      ...baseCtx,
      payments: [
        {
          id: "PAY_OCT_ALICE",
          order_id: "ORD_OCT_ALICE",
          status: "COMPLETED",
          tip_money: { amount: 500, currency: "USD" },
          processing_fee: [{ amount_money: { amount: 290, currency: "USD" } }],
        },
      ],
    },
  );
  aliceOct.lines[0].statementId = DEMO.aliceOct;

  const bobOct = ingestOrder(
    {
      id: "ORD_OCT_BOB",
      location_id: "LOC_MAIN",
      state: "COMPLETED",
      closed_at: "2026-10-20T16:00:00.000Z",
      total_money: { amount: 8640, currency: "USD" },
      line_items: [
        {
          uid: "lamp",
          name: "Brass lamp",
          quantity: "1",
          item_type: "ITEM",
          catalog_object_id: "VAR_LAMP",
          gross_sales_money: { amount: 8000, currency: "USD" },
          total_tax_money: { amount: 640, currency: "USD" },
        },
      ],
    },
    baseCtx,
  );
  bobOct.lines[0].statementId = DEMO.bobOct;

  const novemberSplit = ingestOrder(
    {
      id: "ORD_NOV_SPLIT",
      location_id: "LOC_MAIN",
      state: "COMPLETED",
      closed_at: "2026-11-02T16:00:00.000Z",
      total_money: { amount: 9720, currency: "USD" },
      line_items: [
        {
          uid: "vase",
          name: "Milk glass vase",
          quantity: "1",
          item_type: "ITEM",
          catalog_object_id: "VAR_VASE",
          gross_sales_money: { amount: 8000, currency: "USD" },
          applied_discounts: [{ applied_money: { amount: 800, currency: "USD" } }],
          total_tax_money: { amount: 576, currency: "USD" },
        },
        {
          uid: "lamp",
          name: "Brass lamp",
          quantity: "1",
          item_type: "ITEM",
          catalog_object_id: "VAR_LAMP",
          gross_sales_money: { amount: 2000, currency: "USD" },
          applied_discounts: [{ applied_money: { amount: 200, currency: "USD" } }],
          total_tax_money: { amount: 144, currency: "USD" },
        },
      ],
    },
    baseCtx,
  );

  const quilt = ingestOrder(
    {
      id: "ORD_NOV_QUILT",
      location_id: "LOC_ANNEX",
      state: "COMPLETED",
      closed_at: "2026-11-03T16:00:00.000Z",
      total_money: { amount: 5400, currency: "USD" },
      line_items: [
        {
          uid: "quilt",
          name: "Log cabin quilt",
          quantity: "1",
          item_type: "ITEM",
          catalog_object_id: "VAR_QUILT",
          category_name: "Textiles",
          sku: "CD-7",
          gross_sales_money: { amount: 5000, currency: "USD" },
          total_tax_money: { amount: 400, currency: "USD" },
        },
      ],
    },
    baseCtx,
  );

  const custom = ingestOrder(
    {
      id: "ORD_NOV_CUSTOM",
      location_id: "LOC_MAIN",
      state: "COMPLETED",
      closed_at: "2026-11-03T18:00:00.000Z",
      total_money: { amount: 2500, currency: "USD" },
      line_items: [
        {
          uid: "custom",
          name: "Custom amount",
          quantity: "1",
          item_type: "CUSTOM_AMOUNT",
          gross_sales_money: { amount: 2500, currency: "USD" },
        },
      ],
    },
    baseCtx,
  );

  const refund = ingestOrder(
    {
      id: "ORD_NOV_REFUND",
      location_id: "LOC_MAIN",
      state: "COMPLETED",
      closed_at: "2026-11-04T15:00:00.000Z",
      returns: [
        {
          source_order_id: "ORD_OCT_ALICE",
          return_line_items: [{ uid: "ret-vase", source_line_item_uid: "vase", quantity: "1", name: "Milk glass vase" }],
        },
      ],
    },
    {
      ...baseCtx,
      priorLines: aliceOct.lines,
      statementStatus: { [DEMO.aliceOct]: "paid" },
      closedPeriods: { [DEMO.alice]: ["2026-10"] },
    },
  );

  const aliceMath = computeStatementMath({
    openingCents: 0,
    lines: aliceOct.lines,
    boothRentCents: 0,
    deductRent: true,
  });
  const bobMath = computeStatementMath({
    openingCents: 0,
    lines: bobOct.lines,
    boothRentCents: bob.boothRentCents,
    deductRent: true,
  });

  const dump: StoreDump = {
    users: [
      user(DEMO.marina, "marina@harborpine.demo", "Marina Cole", false),
      user(DEMO.sam, "sam@harborpine.demo", "Sam Patel", false),
      user(DEMO.aliceUser, "alice@vendors.demo", "Alice Hart", false),
      user(DEMO.bobUser, "bob@vendors.demo", "Bob Keene", false),
      user(DEMO.mark, "mark@vendorbooks.demo", "Mark", true),
    ],
    shops: [
      {
        id: DEMO.shop,
        name: "Harbor & Pine Vendor Mall",
        slug: "harbor-pine",
        plan: "shop",
        trialEndsAt: null,
        stripeCustomerId: "cus_demo_harbor",
        stripeSubscriptionId: "sub_demo_harbor",
        stripeStatus: "active",
        billingGraceUntil: null,
        trialEndingEmailSentAt: null,
        timezone: "America/New_York",
        statementDay: 1,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    members: [
      { shopId: DEMO.shop, userId: DEMO.marina, role: "owner", createdAt: "2026-09-01T00:00:00.000Z" },
      { shopId: DEMO.shop, userId: DEMO.sam, role: "bookkeeper", createdAt: "2026-09-01T00:00:00.000Z" },
    ],
    settings: [settings],
    connections: [
      {
        shopId: DEMO.shop,
        merchantId: "ML8HARBORPINE",
        accessTokenCipher: "demo:access-not-a-real-token",
        refreshTokenCipher: "demo:refresh-not-a-real-token",
        tokenExpiresAt: "2026-12-01T00:00:00.000Z",
        scopes: [...SQUARE_SCOPES],
        lastRefreshedAt: "2026-11-03T12:00:00.000Z",
        revokedAt: null,
        sandbox: true,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    locations: [
      { id: DEMO.main, shopId: DEMO.shop, squareLocationId: "LOC_MAIN", name: "Main Hall", active: true },
      { id: DEMO.annex, shopId: DEMO.shop, squareLocationId: "LOC_ANNEX", name: "Annex", active: true },
    ],
    vendors,
    portals: [
      { vendorId: DEMO.alice, authUserId: DEMO.aliceUser, invitedEmail: "alice@vendors.demo", invitedAt: "2026-09-02T00:00:00.000Z", lastLoginAt: null },
      { vendorId: DEMO.bob, authUserId: DEMO.bobUser, invitedEmail: "bob@vendors.demo", invitedAt: "2026-09-02T00:00:00.000Z", lastLoginAt: null },
    ],
    catalogItems: items,
    catalogAttrs: attrs,
    rules,
    ledger: [...aliceOct.lines, ...bobOct.lines, ...novemberSplit.lines, ...quilt.lines, ...custom.lines, ...refund.lines],
    unassigned: custom.unassigned.map((flag, index) => {
      const ledgerLine = custom.lines.find((line) => `${line.shopId}|${line.squareOrderId}|${line.squareLineUid}|${line.lineKind}` === flag.naturalKey);
      return {
        id: `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee${index + 1}`,
        shopId: DEMO.shop,
        ledgerLineId: ledgerLine?.id ?? custom.lines[0].id,
        reason: flag.reason,
        status: "open" as const,
        allocatedVendorId: null,
        resolvedAt: null,
        createdAt: NOW,
      };
    }),
    statements: [
      {
        id: DEMO.aliceOct,
        shopId: DEMO.shop,
        vendorId: DEMO.alice,
        periodYm: "2026-10",
        status: "paid",
        ...aliceMath,
        squareSalesTotalCents: 10800,
        reconcileDeltaCents: 0,
        pdfPath: null,
        csvPath: null,
        approvedAt: "2026-11-01T15:00:00.000Z",
        paidAt: "2026-11-02T15:00:00.000Z",
        paidMethod: "check",
        paidReference: "1042",
        writtenOffAt: null,
      },
      {
        id: DEMO.bobOct,
        shopId: DEMO.shop,
        vendorId: DEMO.bob,
        periodYm: "2026-10",
        status: "approved",
        ...bobMath,
        squareSalesTotalCents: 8640,
        reconcileDeltaCents: 0,
        pdfPath: null,
        csvPath: null,
        approvedAt: "2026-11-01T15:00:00.000Z",
        paidAt: null,
        paidMethod: null,
        paidReference: null,
        writtenOffAt: null,
      },
    ],
    webhooks: [],
    reconciles: [
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        shopId: DEMO.shop,
        ranAt: "2026-11-04T08:30:00.000Z",
        windowStart: "2026-11-02T00:00:00.000Z",
        windowEnd: "2026-11-04T15:00:00.000Z",
        squareOrderCount: 4,
        ledgerLineCount: 5,
        mismatchCount: 0,
        notes: { source: "demo" },
      },
    ],
    backfills: [
      {
        id: "ffffffff-ffff-4fff-8fff-ffffffffff01",
        shopId: DEMO.shop,
        status: "completed",
        ordersSeen: 5,
        linesUpserted: 6,
        error: null,
        startedAt: "2026-09-01T12:00:00.000Z",
        finishedAt: "2026-09-01T12:05:00.000Z",
      },
    ],
    audit: [
      {
        id: "99999999-9999-4999-8999-999999999999",
        actorUserId: DEMO.marina,
        action: "shop.created",
        meta: { shopId: DEMO.shop, name: "Harbor & Pine Vendor Mall" },
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    emails: [
      {
        id: "99999999-9999-4999-8999-999999999991",
        shopId: DEMO.shop,
        toEmail: "alice@vendors.demo",
        template: "statement_ready",
        subject: "Harbor & Pine Vendor Mall statement for 2026-10 is ready",
        bodyPreview: "Amount for the shop to pay you: $60.00. The shop pays that amount directly.",
        status: "logged",
        error: null,
        createdAt: "2026-11-01T15:05:00.000Z",
      },
    ],
  };
  return dump;
}

function user(id: string, email: string, fullName: string, isPlatformAdmin: boolean) {
  return { id, email, fullName, isPlatformAdmin, createdAt: "2026-09-01T00:00:00.000Z" };
}

function item(
  catalogObjectId: string,
  objectType: "ITEM" | "ITEM_VARIATION",
  parentObjectId: string | null,
  name: string,
  sku: string | null,
  categoryName: string,
): CatalogItem {
  return {
    shopId: DEMO.shop,
    catalogObjectId,
    parentObjectId,
    objectType,
    name,
    sku,
    categoryName,
    catalogVersion: 3,
    updatedAt: NOW,
  };
}
