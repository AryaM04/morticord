# Link previews

This note explains how a message gets a link preview card. The sender's
client makes the preview **before** it encrypts the message. A receiver
never fetches the URL. Thus a link in an encrypted message does not tell
the site who reads the message, or when.

## Send

1. The composer finds the first `http` or `https` link in the text. A
   message has at most one preview. A link in angle brackets
   (`<https://example.com>`) gets no preview.
2. After a pause of 600 ms in typing, the composer loads
   `apps/web/src/lib/link-preview.ts` and calls
   `platform.fetchLinkPreview(url)`. The result is
   `{ url, title?, description?, siteName?, image?: { bytes, mime } }`.
3. The client encrypts the image as an attachment (see `attachments.md`),
   with its 320 px thumbnail. An image that the browser cannot read is
   dropped. The rest of the preview stays.
4. The composer shows the card, with a "Remove preview" button. A removed
   preview does not come back for the same link in this draft.
5. The message takes the preview only when the card is ready at send time.
   The Megolm payload holds the embed:
   `embeds: [{ type: "link", url, title?, description?, siteName?, image? }]`.
   `image` is a full attachment entry. After the send, the client claims
   the image and its thumbnail.

An edit does not change the preview. A receiver drops an embed that it
cannot read (a newer type or bad data), and shows the rest of the message.

The user setting "Show link previews for my messages" (a synced setting,
`linkPreviews`, on by default) turns step 2 off.

## Where the page is fetched

| Client  | Fetch                                                     |
| ------- | --------------------------------------------------------- |
| Web     | `POST /api/v1/link-preview` on our own server             |
| Desktop | The Rust command `link_preview_fetch` of the desktop app, with the same address rules, through the same `Platform` hook |

A browser page cannot read another site (CORS). Thus the web client asks
its own home server. **Trade-off:** the server sees the URL of each
preview. It does not log the URL, and it keeps the result only in memory
for 10 minutes. A user who does not want this can turn the setting off.

## The server route

`POST /api/v1/link-preview` with `{ "url": "https://..." }` returns
`{ url, title?, description?, siteName?, image?: { mime, data } }`. `data`
is base64url. The code is in `apps/server/src/modules/link-preview/`.

The server fetches a URL that a user names, so the route must not open
the private network of the server to a user (server-side request
forgery, SSRF). The rules:

- Only `http` and `https`. Only ports 80 and 443. No user name or
  password in the URL.
- The server resolves the host name itself and checks **every** address.
  It refuses a name with one blocked address: loopback, private
  (10/8, 172.16/12, 192.168/16), carrier-grade NAT, link-local (this
  includes the cloud metadata address 169.254.169.254), multicast,
  reserved, IPv6 loopback, unique local (`fc00::/7`), link-local
  (`fe80::/10`), NAT64, 6to4 and Teredo. An IPv4-mapped IPv6 address gets
  the IPv4 rules.
- The connection uses the checked address (a custom `lookup`). Thus a DNS
  answer that changes between the check and the connection (DNS
  rebinding) cannot reach a private address.
- At most 3 redirects. Each redirect target goes through all the checks
  again.
- One time limit of 3 s for the page and the image. The server reads at
  most 512 KiB of HTML and ignores the rest. It drops an image larger than
  2 MiB. Only PNG, JPEG, GIF and WebP images are kept.
- A small, tolerant reader (`html-meta.ts`) takes the OpenGraph
  (`og:*`), Twitter card (`twitter:*`), `description` and `<title>`
  values. It does not build a DOM.
- 20 requests a minute for each user. Error texts never hold the URL.

The web client waits 4 s for the route: the 3 s fetch, plus the time to
send the image.

For the end-to-end test only, `LINK_PREVIEW_TEST_ALLOW_LOOPBACK=true` lets
the server fetch loopback addresses on any port. Every other blocked
address stays blocked. Do not set it on a real server.

## Receive

The card shows the site name, the title (a link to the URL), the
description and the image thumbnail. The client downloads and decrypts
the image like any other attachment. It never requests the URL itself.
The link opens with `rel="noopener noreferrer nofollow"`.
