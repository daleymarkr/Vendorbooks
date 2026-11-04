"use client";

import { useMemo, useState } from "react";
import { calculateCsvPayouts, calculatorResultCsv, parseSalesCsv } from "@/domain/csv";
import { formatUsd } from "@/domain/money";

const SAMPLE = `vendor,gross,discount,tax,commission_percent,booth_rent
Alice,100,0,8,60,0
Bob,20,2,1.60,50,75`;

export function Calculator() {
  const [text, setText] = useState(SAMPLE);
  const parsed = useMemo(() => {
    try {
      return { totals: calculateCsvPayouts(parseSalesCsv(text)), error: null as string | null };
    } catch (err) {
      return { totals: [], error: err instanceof Error ? err.message : "Could not read that CSV." };
    }
  }, [text]);
  const { totals, error } = parsed;

  function download() {
    const csv = calculatorResultCsv(totals);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "vendorbooks-payouts.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <label className="block">
        <span className="label">Sales CSV</span>
        <textarea className="field min-h-64 font-mono text-xs" value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <div className="card p-5">
        <h2 className="font-serif text-2xl text-pine">Amount for the shop to pay</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Tax stays out of the base. Booth rent is taken once per vendor, using the largest rent on that vendor&apos;s rows. This calculator does not call Square.
        </p>
        {error ? <p className="banner-bad mt-4">{error}</p> : null}
        <div className="mt-4 table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Base</th>
                <th>Earn</th>
                <th>Rent</th>
                <th>To pay</th>
              </tr>
            </thead>
            <tbody>
              {totals.map((row) => (
                <tr key={row.vendor}>
                  <td>{row.vendor}</td>
                  <td>{formatUsd(row.baseCents)}</td>
                  <td>{formatUsd(row.earnCents)}</td>
                  <td>{formatUsd(row.boothRentCents)}</td>
                  <td>{formatUsd(row.amountToPayCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn-primary mt-4" type="button" onClick={download} disabled={!totals.length}>
          Download payout CSV
        </button>
      </div>
    </div>
  );
}
