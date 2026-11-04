import { FORBIDDEN_MONEY_PHRASES } from "./types";

export function findForbiddenMoneyPhrases(text: string): string[] {
  const haystack = text.toLowerCase();
  return FORBIDDEN_MONEY_PHRASES.filter((phrase) => haystack.includes(phrase));
}

export const MONEY_DISCLAIMER =
  "VendorBooks calculates what the shop owes each vendor and records when the shop marks a payout paid. The shop pays vendors outside VendorBooks. VendorBooks does not hold, receive, or move money.";
