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
  /** Find the messages to one recipient with one subject, newest first. Other tests cannot change the result. */
  async function searchMessages(recipient: string, subject: string): Promise<MailpitMessageSummary[]> {
    const query = encodeURIComponent(`to:"${recipient}" subject:"${subject}"`);
    const response = await fetch(`${baseUrl}/api/v1/search?query=${query}`);
    if (!response.ok) {
      throw new Error(`Mailpit search request failed with status ${response.status}.`);
    }
    const body = (await response.json()) as { messages: MailpitMessageSummary[] };
    return body.messages.filter(
      (message) => message.Subject === subject && message.To.some((to) => to.Address === recipient),
    );
  }

  async function readMessage(id: string): Promise<MailpitMessage> {
    const response = await fetch(`${baseUrl}/api/v1/message/${id}`);
    if (!response.ok) {
      throw new Error(`Mailpit read request failed with status ${response.status}.`);
    }
    return (await response.json()) as MailpitMessage;
  }

  /** Poll for the newest message to a recipient with a subject, then pull a "#name=value" link out of its text. */
  async function findHashLinkFor(
    recipient: string,
    subject: string,
    hashKey: string,
    options: { timeoutMs?: number; intervalMs?: number } = {},
  ): Promise<string> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const intervalMs = options.intervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const [match] = await searchMessages(recipient, subject);
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
    throw new Error(`No email to ${recipient} with the subject "${subject}" and a "${hashKey}" link arrived within ${timeoutMs}ms.`);
  }

  return { searchMessages, readMessage, findHashLinkFor };
}
