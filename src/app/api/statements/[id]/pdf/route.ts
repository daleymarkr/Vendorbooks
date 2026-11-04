import { visibleStatements } from "@/domain/visibility";
import { statementFiles } from "@/server/workflows";
import { requireViewer } from "@/server/session";
import { getStore } from "@/server/store";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const viewer = await requireViewer();
  const store = await getStore();
  const statement = await store.getStatement(id);
  if (!statement) return new Response("Not found", { status: 404 });
  const allowed = visibleStatements([statement], {
    userId: viewer.user.id,
    isPlatformAdmin: viewer.isPlatformAdmin,
    memberships: viewer.memberships,
    vendorId: viewer.vendorId,
  });
  if (!allowed.length) return new Response("Not found", { status: 404 });
  const files = await statementFiles(store, id);
  return new Response(Buffer.from(files.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="vendorbooks-${statement.periodYm}.pdf"`,
    },
  });
}
