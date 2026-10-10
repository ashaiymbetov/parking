import { createTransport, Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Deterministic per outbox row, so a resent duplicate can be merged. */
  messageId: string;
}

/** Outgoing mail. A Nest provider token: tests swap in a failing one. */
export abstract class Mailer {
  abstract send(message: MailMessage): Promise<void>;
}

export interface SmtpSettings {
  host: string;
  port: number;
  from: string;
}

/** Plain SMTP without TLS — Mailpit in compose (CLAUDE.md: stub mail). */
export class SmtpMailer extends Mailer {
  private readonly transport: Transporter;

  constructor(private readonly settings: SmtpSettings) {
    super();
    this.transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: false,
      ignoreTLS: true,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.settings.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      messageId: `<${message.messageId}>`,
    });
  }
}
