import { NextResponse } from "next/server";
import { finishSquareConnect } from "@/server/workflows";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (error || !code || !state) {
    return NextResponse.redirect(new URL(`/app/connect?error=${encodeURIComponent(error || "Square did not return a code.")}`, request.url));
  }
  try {
    await finishSquareConnect({ code, state });
    return NextResponse.redirect(new URL("/app/connect?connected=1", request.url));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Square connection failed.";
    return NextResponse.redirect(new URL(`/app/connect?error=${encodeURIComponent(message)}`, request.url));
  }
}
