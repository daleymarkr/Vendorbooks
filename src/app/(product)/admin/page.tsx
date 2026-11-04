import { toPublicConnection } from "@/domain/square";
import { PageIntro } from "@/components/ui";
import { getStore } from "@/server/store";

export default async function AdminHome() {
  const store = await getStore();
  const shops = await store.listAllShops();
  const rows = await Promise.all(shops.map(async (shop) => ({
    shop,
    vendors: (await store.listVendors(shop.id)).length,
    connection: toPublicConnection(await store.getConnection(shop.id)),
  })));
  return (
    <div>
      <PageIntro title="Shops" lede="Plan, billing status, and whether Square is connected. Tokens are not shown here." />
      <div className="card table-wrap">
        <table className="data">
          <thead><tr><th>Shop</th><th>Plan</th><th>Stripe</th><th>Square</th><th>Vendors</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.shop.id}>
                <td>{row.shop.name}</td>
                <td>{row.shop.plan}</td>
                <td>{row.shop.stripeStatus ?? "—"}</td>
                <td>{row.connection.connected ? row.connection.merchantId : "No"}</td>
                <td>{row.vendors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
