// Small static file server for the WebRTC test fixture.
//
// The fixture page must load from a real HTTP origin. Chromium treats
// "localhost" as a secure context, so getUserMedia works there, but not
// under a "file:" URL. This server has no other job.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const port = process.env.PORT ? Number(process.env.PORT) : 4310;

const server = createServer((_request, response) => {
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
