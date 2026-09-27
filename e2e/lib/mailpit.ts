// A tiny client for the Mailpit HTTP API, used to read the verification
// and password reset emails the server sends during the auth e2e tests.
// See https://mailpit.axllent.org/docs/api-v1/ for the endpoints used here.

export interface MailpitMessageSummary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
}

export interface MailpitMessage {
  Text: string;
}

export function createMailpitClient(baseUrl: string) {
  async function listMessages(): Promise<MailpitMessageSummary[]> {
    const response = await fetch(`${baseUrl}/api/v1/messages`);
    if (!response.ok) {
      throw new Error(`Mailpit list request failed with status ${response.status}.`);
    }
    const body = (await response.json()) as { messages: MailpitMessageSummary[] };
    return body.messages;
  }

  async function readMessage(id: string): Promise<MailpitMessage> {
    const response = await fetch(`${baseUrl}/api/v1/message/${id}`);
    if (!response.ok) {
      throw new Error(`Mailpit read request failed with status ${response.status}.`);
    }
    return (await response.json()) as MailpitMessage;
  }

  /** Poll for the newest message to a recipient, then pull a "#name=value" link out of its text. */
  async function findHashLinkFor(
    recipient: string,
    hashKey: string,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const intervalMs = options.intervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const messages = await listMessages();
      const match = messages.find((message) => message.To.some((to) => to.Address === recipient));
      if (match) {
        const full = await readMessage(match.ID);
        const pattern = new RegExp(`${hashKey}=([^\\s]+)`);
        const found = pattern.exec(full.Text);
        if (found) {
          return found[1]!;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(`No email to ${recipient} with a "${hashKey}" link arrived within ${timeoutMs}ms.`);
  }

  async function deleteAllMessages(): Promise<void> {
    await fetch(`${baseUrl}/api/v1/messages`, { method: "DELETE" });
  }

  return { listMessages, readMessage, findHashLinkFor, deleteAllMessages };
}
