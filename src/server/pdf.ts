import "server-only";

import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import type { StatementDocument } from "@/domain/statements";

export async function renderStatementPdf(doc: StatementDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const ink = rgb(0.09, 0.13, 0.11);
  const pine = rgb(0.11, 0.25, 0.2);
  page.drawRectangle({ x: 0, y: 742, width: 612, height: 50, color: pine });
  page.drawText("VendorBooks", { x: 48, y: 762, size: 18, font: bold, color: rgb(0.96, 0.94, 0.9) });
  page.drawText("Statement", { x: 470, y: 762, size: 14, font, color: rgb(0.96, 0.94, 0.9) });
  let y = 710;
  for (const line of doc.lines) {
    page.drawText(line.slice(0, 90), { x: 48, y, size: 12, font: line.startsWith("Amount") ? bold : font, color: ink });
    y -= 22;
  }
  y -= 8;
  page.drawText("Detail", { x: 48, y, size: 12, font: bold, color: pine });
  y -= 18;
  const detail = doc.detail.slice(0, 18);
  for (const row of detail) {
    const text = row.join("  ·  ").slice(0, 100);
    page.drawText(text, { x: 48, y, size: 9, font, color: ink });
    y -= 14;
    if (y < 120) break;
  }
  const words = wrap(doc.disclaimer, 85);
  let footer = 96;
  for (const line of words) {
    page.drawText(line, { x: 48, y: footer, size: 9, font, color: rgb(0.35, 0.4, 0.38) });
    footer -= 12;
  }
  if (doc.watermark) {
    page.drawText(doc.watermark, { x: 140, y: 360, size: 42, font: bold, color: rgb(0.75, 0.68, 0.55), rotate: degrees(28), opacity: 0.35 });
  }
  return pdf.save();
}

function wrap(text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}
