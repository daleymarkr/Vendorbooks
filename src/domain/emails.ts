import { formatUsd } from "./money";

export type EmailMessage = {
  template: "statement_ready" | "portal_invite" | "trial_ending" | "payment_failed" | "token_stale";
  to: string;
  subject: string;
  text: string;
  html: string;
};

const FOOTER =
  "VendorBooks calculates vendor amounts and keeps the record. Your shop pays vendors directly. VendorBooks does not hold or move money.";

export function statementReadyEmail(input: {
  to: string;
  shopName: string;
  vendorName: string;
  periodYm: string;
  payoutCents: number;
  statementUrl: string;
}): EmailMessage {
  const amount = formatUsd(input.payoutCents);
  const subject = `${input.shopName} statement for ${input.periodYm} is ready`;
  const text = [
    `Hello ${input.vendorName},`,
    ``,
    `${input.shopName} prepared your VendorBooks statement for ${input.periodYm}.`,
    `Amount for the shop to pay you: ${amount}.`,
    `The shop pays that amount directly. VendorBooks does not send it.`,
    `View the statement: ${input.statementUrl}`,
    ``,
    FOOTER,
  ].join("\n");
  return { template: "statement_ready", to: input.to, subject, text, html: paragraphHtml(text) };
}

export function portalInviteEmail(input: { to: string; shopName: string; vendorName: string; link: string }): EmailMessage {
  const subject = `${input.shopName} invited you to your VendorBooks portal`;
  const text = [
    `Hello ${input.vendorName},`,
    ``,
    `${input.shopName} keeps your sales and statements in VendorBooks.`,
    `Open your read-only portal: ${input.link}`,
    `You can review sales and download statements. Commission and catalog stay with the shop.`,
    ``,
    FOOTER,
  ].join("\n");
  return { template: "portal_invite", to: input.to, subject, text, html: paragraphHtml(text) };
}

export function trialEndingEmail(input: { to: string; shopName: string; trialEndsAt: string; billingUrl: string }): EmailMessage {
  const subject = `Your VendorBooks trial for ${input.shopName} ends soon`;
  const text = [
    `Hello,`,
    ``,
    `The VendorBooks trial for ${input.shopName} ends on ${input.trialEndsAt.slice(0, 10)}.`,
    `After that, the shop returns to the Free plan unless you choose Shop or Mall.`,
    `Review billing: ${input.billingUrl}`,
    ``,
    FOOTER,
  ].join("\n");
  return { template: "trial_ending", to: input.to, subject, text, html: paragraphHtml(text) };
}

export function paymentFailedEmail(input: { to: string; shopName: string; billingUrl: string }): EmailMessage {
  const subject = `VendorBooks billing needs attention for ${input.shopName}`;
  const text = [
    `Hello,`,
    ``,
    `The subscription payment for ${input.shopName} did not go through.`,
    `VendorBooks stays available for 3 days. After that the shop becomes read-only until billing is updated.`,
    `Update billing: ${input.billingUrl}`,
    ``,
    FOOTER,
  ].join("\n");
  return { template: "payment_failed", to: input.to, subject, text, html: paragraphHtml(text) };
}

export function tokenStaleEmail(input: { to: string; shopName: string }): EmailMessage {
  const subject = `VendorBooks needs a Square reconnect for ${input.shopName}`;
  const text = [
    `Hello,`,
    ``,
    `Square access for ${input.shopName} has not refreshed in more than 8 days.`,
    `Open VendorBooks and reconnect Square so new sales keep flowing into the ledger.`,
    `VendorBooks still does not move money. This is only the read connection to Square.`,
    ``,
    FOOTER,
  ].join("\n");
  return { template: "token_stale", to: input.to, subject, text, html: paragraphHtml(text) };
}

function paragraphHtml(text: string): string {
  const body = text
    .split("\n")
    .map((line) => (line ? `<p>${escapeHtml(line)}</p>` : ""))
    .join("");
  return `<div style="font-family:Georgia,serif;color:#17211d">${body}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
