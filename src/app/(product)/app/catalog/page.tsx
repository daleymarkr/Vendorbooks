import { redirect } from "next/navigation";
import { taggedPercent } from "@/domain/attribution";
import { addRuleAction, deleteRuleAction, importCsvAction, saveTagsAction } from "@/server/actions";
import { Flash, PageIntro } from "@/components/ui";
import { PendingButton } from "@/components/submit-button";
import { loadShop } from "@/server/load";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const bundle = await loadShop();
  if (!bundle.shop) redirect("/app/onboarding");
  const query = await searchParams;
  const [items, attrs, rules] = await Promise.all([
    bundle.store.listCatalogItems(bundle.shop.id),
    bundle.store.listCatalogAttrs(bundle.shop.id),
    bundle.store.listRules(bundle.shop.id),
  ]);
  const active = bundle.vendors.filter((vendor) => !vendor.archivedAt);
  const percent = taggedPercent(items, attrs);
  return (
    <div className="space-y-8">
      <PageIntro title="Catalog attribution" lede={`${percent}% of variations carry a vendor attribute. A variation is checked first, then its parent item, then rules, then a CSV map.`} />
      <Flash error={query.error} notice={query.notice} />
      <form action={saveTagsAction} className="card table-wrap">
        <table className="data">
          <thead><tr><th>Item</th><th>SKU</th><th>Category</th><th>Vendor</th></tr></thead>
          <tbody>
            {items.filter((item) => item.objectType === "ITEM_VARIATION").map((item) => {
              const current = attrs.find((attr) => attr.catalogObjectId === item.catalogObjectId)?.vendorId
                ?? (item.parentObjectId ? attrs.find((attr) => attr.catalogObjectId === item.parentObjectId)?.vendorId : "")
                ?? "";
              return (
                <tr key={item.catalogObjectId}>
                  <td>{item.name}<input type="hidden" name="catalogObjectId" value={item.catalogObjectId} /></td>
                  <td>{item.sku}</td>
                  <td>{item.categoryName}</td>
                  <td>
                    <select className="field" name="vendorId" defaultValue={current ?? ""}>
                      <option value="">Unassigned</option>
                      {active.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.displayName}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="p-4"><PendingButton>Save tags</PendingButton></div>
      </form>
      <div className="grid gap-4 lg:grid-cols-2">
        <form action={addRuleAction} className="card space-y-3 p-5">
          <h2 className="font-serif text-2xl text-pine">Add a rule</h2>
          <label className="block"><span className="label">Priority</span><input className="field" name="priority" defaultValue="100" /></label>
          <label className="block"><span className="label">Type</span>
            <select className="field" name="ruleType"><option value="sku_prefix">SKU prefix</option><option value="category">Category</option><option value="name_pattern">Name contains</option></select>
          </label>
          <label className="block"><span className="label">Pattern</span><input className="field" name="pattern" required /></label>
          <label className="block"><span className="label">Vendor</span>
            <select className="field" name="vendorId">{active.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.displayName}</option>)}</select>
          </label>
          <PendingButton>Add rule</PendingButton>
        </form>
        <ul className="card space-y-2 p-5 text-sm text-ink-soft">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-2">
              <span>{rule.priority}. {rule.ruleType} “{rule.pattern}”</span>
              <form action={deleteRuleAction}>
                <input type="hidden" name="id" value={rule.id} />
                <button className="text-brick" type="submit">Remove</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={importCsvAction} className="card space-y-3 p-5">
          <h2 className="font-serif text-2xl text-pine">CSV import</h2>
          <p className="text-sm text-ink-soft">Columns: vendor and either sku or catalog_object_id. CSV maps are used after rules.</p>
          <input className="field" type="file" name="file" accept=".csv,text/csv" />
          <PendingButton variant="ghost">Import</PendingButton>
        </form>
      </div>
    </div>
  );
}
