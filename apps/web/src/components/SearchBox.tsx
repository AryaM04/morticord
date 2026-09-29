// The search box of the chat header. Enter opens the results panel. The
// panel and the search code load only then, to keep the main bundle small.
import { lazy, Suspense, useState } from "react";

const SearchPanel = lazy(() => import("./SearchPanel.js"));

export function SearchBox({ guildId }: { guildId: string | null }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  return (
    <div className="ml-auto shrink-0 px-2">
      <input
        type="search"
        aria-label="Search messages"
        placeholder="Search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && text.trim()) {
            setQuery(text.trim());
          } else if (event.key === "Escape") {
            setQuery(null);
          }
        }}
        className="w-44 rounded px-2 py-1 text-sm"
        style={{ backgroundColor: "var(--color-bg-sidebar)", color: "var(--color-text-primary)" }}
      />
      {query !== null && (
        <Suspense fallback={null}>
          <SearchPanel query={query} guildId={guildId} onClose={() => setQuery(null)} />
        </Suspense>
      )}
    </div>
  );
}
