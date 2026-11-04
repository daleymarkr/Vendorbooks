import { PageIntro, Stamp } from "@/components/ui";
import { getStore } from "@/server/store";

export default async function WebhooksPage() {
  const events = await (await getStore()).listWebhookEvents();
  const problems = events.filter((event) => event.status === "error");
  return (
    <div>
      <PageIntro title="Webhook queue" lede={`${problems.length} errors in the recent log. Replays of a processed event id do not create a second ledger line.`} />
      <div className="card table-wrap">
        <table className="data">
          <thead><tr><th>When</th><th>Type</th><th>Status</th><th>Error</th></tr></thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.eventId}>
                <td>{event.receivedAt.slice(0, 16).replace("T", " ")}</td>
                <td>{event.eventType}</td>
                <td><Stamp tone={event.status === "error" ? "bad" : "ink"}>{event.status}</Stamp></td>
                <td className="max-w-sm">{event.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
