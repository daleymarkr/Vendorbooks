import { NextResponse } from "next/server";
import { isDemoMode, sessionSecret } from "@/domain/env";
import { readSessionToken } from "@/domain/session-token";
import { setDemoSession } from "@/server/session";

export async function GET(request: Request) {
  if (!isDemoMode()) return NextResponse.redirect(new URL("/login", request.url));
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const userId = await readSessionToken(token, sessionSecret());
  if (!userId) return NextResponse.redirect(new URL("/login?error=Invite+link+expired", request.url));
  await setDemoSession(userId);
  return NextResponse.redirect(new URL("/portal", request.url));
}
