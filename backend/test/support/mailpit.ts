import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export interface MailpitMessage {
  ID: string;
  MessageID: string;
  Subject: string;
  To: { Address: string }[];
}

export interface Mailpit {
  smtpHost: string;
  smtpPort: number;
  /** All messages, newest first. */
  messages(): Promise<MailpitMessage[]>;
  /** Plain-text body of one message. */
  text(id: string): Promise<string>;
  clear(): Promise<void>;
  stop(): Promise<void>;
}

/** A real Mailpit (the same image as in compose), driven over its HTTP API. */
export async function startMailpit(): Promise<Mailpit> {
  const container: StartedTestContainer = await new GenericContainer(
    'axllent/mailpit:v1.31.4',
  )
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const api = `http://${container.getHost()}:${container.getMappedPort(8025)}/api/v1`;

  const call = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${api}${path}`, init);
    if (!res.ok) throw new Error(`Mailpit ${path}: ${res.status}`);
    return res;
  };

  return {
    smtpHost: container.getHost(),
    smtpPort: container.getMappedPort(1025),
    async messages() {
      const body = (await (await call('/messages')).json()) as {
        messages: MailpitMessage[];
      };
      return body.messages;
    },
    async text(id) {
      const body = (await (await call(`/message/${id}`)).json()) as {
        Text: string;
      };
      return body.Text;
    },
    async clear() {
      await call('/messages', { method: 'DELETE' });
    },
    async stop() {
      await container.stop();
    },
  };
}
