import { PageIntro } from "@/components/ui";
import { getStore } from "@/server/store";

export default async function AuditPage() {
  const entries = await (await getStore()).listAudit();
  return (
    <div>
      <PageIntro title="Audit log" />
      <div className="card table-wrap">
        <table className="data">
          <thead><tr><th>When</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}><td>{entry.createdAt.slice(0, 16).replace("T", " ")}</td><td>{entry.action}</td><td className="font-mono text-xs">{JSON.stringify(entry.meta)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
