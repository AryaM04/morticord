// Small static file server for the WebRTC test fixture.
//
// The fixture page must load from a real HTTP origin. Chromium treats
// "localhost" as a secure context, so getUserMedia works there, but not
// under a "file:" URL. It also serves a page with OpenGraph tags and its
// image, for the link preview test (link-preview.spec.ts).
import { Buffer } from "node:buffer";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT ? Number(process.env.PORT) : 4310;

// A 16 x 16 red PNG.
const OG_IMAGE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGO4o6FBEmIY1TCqYfhqAAAyBCwQhvh37QAAAABJRU5ErkJggg==",
  "base64",
);

const OG_PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>Fixture page</title>
<meta property="og:title" content="The Fixture Article">
<meta property="og:description" content="A page with OpenGraph tags for the link preview test.">
<meta property="og:site_name" content="Fixture News">
<meta property="og:image" content="/og-image.png">
</head><body>Fixture</body></html>`;

const server = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === "/og-page") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(OG_PAGE);
    return;
  }
  if (pathname === "/og-image.png") {
    response.writeHead(200, { "Content-Type": "image/png" });
    response.end(OG_IMAGE);
    return;
  }
  readFile(join(here, "peer.html"))
    .then((body) => {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(body);
    })
    .catch(() => {
      response.writeHead(404);
      response.end();
    });
});

server.listen(port, () => {
  console.log(`Fixture server is ready. It listens on http://localhost:${port}`);
});
