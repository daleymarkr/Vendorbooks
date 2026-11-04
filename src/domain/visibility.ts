import type { LedgerLine, Membership, Statement, Vendor } from "./types";

export type ViewerScope = {
  userId: string;
  isPlatformAdmin: boolean;
  memberships: Membership[];
  vendorId: string | null;
  serviceRole?: boolean;
};

export function canReadSquareConnection(scope: ViewerScope): boolean {
  return scope.serviceRole === true;
}

export function visibleVendors(vendors: Vendor[], scope: ViewerScope): Vendor[] {
  if (scope.serviceRole || scope.isPlatformAdmin) return vendors;
  const shops = new Set(scope.memberships.map((member) => member.shopId));
  return vendors.filter((vendor) => shops.has(vendor.shopId) || vendor.id === scope.vendorId);
}

export function visibleLedger(lines: LedgerLine[], scope: ViewerScope): LedgerLine[] {
  if (scope.serviceRole || scope.isPlatformAdmin) return lines;
  const shops = new Set(scope.memberships.map((member) => member.shopId));
  return lines.filter((line) => shops.has(line.shopId) || (scope.vendorId != null && line.vendorId === scope.vendorId));
}

export function visibleStatements(statements: Statement[], scope: ViewerScope): Statement[] {
  if (scope.serviceRole) return statements;
  const shops = new Set(scope.memberships.map((member) => member.shopId));
  return statements.filter((statement) => {
    if (scope.isPlatformAdmin || shops.has(statement.shopId)) return true;
    return (
      scope.vendorId != null &&
      statement.vendorId === scope.vendorId &&
      (statement.status === "approved" || statement.status === "paid")
    );
  });
}
