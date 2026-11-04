import "server-only";

import { Resend } from "resend";
import type { EmailMessage } from "@/domain/emails";
import type { AppStore } from "@/server/store";

export async function deliverEmail(store: AppStore, shopId: string | null, message: EmailMessage): Promise<void> {
  let status: "logged" | "sent" | "error" = "logged";
  let error: string | null = null;
  if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const result = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      if (result.error) {
        status = "error";
        error = result.error.message;
      } else status = "sent";
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : "Email failed";
    }
  }
  await store.logEmail({
    shopId,
    toEmail: message.to,
    template: message.template,
    subject: message.subject,
    bodyPreview: message.text.slice(0, 280),
    status,
    error,
  });
}
