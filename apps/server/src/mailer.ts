// The mailer interface, plus the real and the fake implementation.
// The auth module sends plain text mail (verification, password reset).
// It never sends HTML, to keep the mailer simple and portable.
import nodemailer from "nodemailer";
import type { AppConfig } from "./config.js";

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** The real mailer. It sends mail through SMTP, using nodemailer. */
export function createSmtpMailer(config: AppConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth:
      config.smtp.user && config.smtp.password
        ? { user: config.smtp.user, pass: config.smtp.password }
        : undefined,
  });

  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: config.smtp.from, to, subject, text });
    },
  };
}

export interface SentMail {
  to: string;
  subject: string;
  text: string;
}

export interface FakeMailer extends Mailer {
  /** Every mail sent so far, in order. Tests read this list. */
  sent: SentMail[];
}

/** A fake mailer for tests. It keeps sent mail in memory and sends nothing. */
export function createFakeMailer(): FakeMailer {
  const sent: SentMail[] = [];
  return {
    sent,
    async send(to, subject, text) {
      sent.push({ to, subject, text });
    },
  };
}
