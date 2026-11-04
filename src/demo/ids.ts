export const DEMO = {
  shop: "11111111-1111-4111-8111-111111111111",
  marina: "22222222-2222-4222-8222-222222222222",
  sam: "22222222-2222-4222-8222-222222222223",
  aliceUser: "33333333-3333-4333-8333-333333333333",
  bobUser: "33333333-3333-4333-8333-333333333334",
  mark: "44444444-4444-4444-8444-444444444444",
  alice: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  bob: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  carol: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  main: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  annex: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  aliceOct: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
  bobOct: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
} as const;

export const DEMO_PASSWORD = "ledger";

export const DEMO_ACCOUNTS = [
  { email: "marina@harborpine.demo", role: "Shop owner", id: DEMO.marina },
  { email: "sam@harborpine.demo", role: "Bookkeeper", id: DEMO.sam },
  { email: "alice@vendors.demo", role: "Vendor portal (Alice)", id: DEMO.aliceUser },
  { email: "mark@vendorbooks.demo", role: "Platform admin", id: DEMO.mark },
] as const;
