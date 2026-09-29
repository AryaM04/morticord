// A small, tolerant reader for the preview fields of an HTML page:
// OpenGraph (`og:*`), Twitter card (`twitter:*`) and plain `<meta
// name="description">` / `<title>`. It does not build a DOM. It reads only
// `<meta>` tags and the first `<title>`, so a broken page gives what it
// can and never throws.

export interface HtmlMeta {
  title?: string;
  description?: string;
  siteName?: string;
  /** The image URL as the page gives it. It can be relative. */
  image?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode the common HTML character references. An unknown reference stays as it is. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Read the attributes of one tag, for example `<meta property="og:title" content="A">`. */
function readAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) {
    const name = match[1]!.toLowerCase();
    if (!attributes.has(name)) {
      attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return attributes;
}

/** Remove control characters, join white space and cut to `max` characters. */
function clean(text: string | undefined, max: number): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  const value = decodeEntities(text)
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (value.length === 0) {
    return undefined;
  }
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Read the preview fields of an HTML page. The limits match the embed schema. */
export function readHtmlMeta(
  html: string,
  limits = { title: 256, description: 1024, siteName: 128 },
): HtmlMeta {
  // Comments and scripts can hold text that looks like a tag.
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");
  const values = new Map<string, string>();
  for (const match of text.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = readAttributes(match[0]);
    const key = (attributes.get("property") ?? attributes.get("name") ?? "").toLowerCase();
    const content = attributes.get("content");
    if (key && content !== undefined && !values.has(key)) {
      values.set(key, content);
    }
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(text)?.[1];

  return {
    title: clean(values.get("og:title") ?? values.get("twitter:title") ?? titleTag, limits.title),
    description: clean(
      values.get("og:description") ??
        values.get("twitter:description") ??
        values.get("description"),
      limits.description,
    ),
    siteName: clean(values.get("og:site_name") ?? values.get("application-name"), limits.siteName),
    image: clean(
      values.get("og:image:secure_url") ??
        values.get("og:image") ??
        values.get("og:image:url") ??
        values.get("twitter:image") ??
        values.get("twitter:image:src"),
      2048,
    ),
  };
}
