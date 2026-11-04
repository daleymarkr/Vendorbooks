"use client";

import { useFormStatus } from "react-dom";

export function PendingButton({ children, variant = "primary" }: { children: React.ReactNode; variant?: "primary" | "ghost" | "danger" | "brass" }) {
  const { pending } = useFormStatus();
  const className = variant === "ghost" ? "btn-ghost" : variant === "danger" ? "btn-danger" : variant === "brass" ? "btn-brass" : "btn-primary";
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}
