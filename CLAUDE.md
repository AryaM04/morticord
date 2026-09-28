# Project rules

Plan: `C:\Users\aryam\.claude\plans\i-want-to-make-sorted-hippo.md` (P2P voice + E2EE chat app, Discord-style).

## Language: ASD-STE100 (Simplified Technical English)
All code text must obey ASD-STE100. This includes comments, docs, commit messages, log text, error text, UI text and README files.
- Use short sentences. Procedural sentences: max 20 words. Descriptive sentences: max 25 words.
- Use one topic per sentence. Use one instruction per sentence.
- Use the active voice. Use the imperative form for instructions ("Start the server.").
- Use only approved words with their approved meaning. Use one word for one meaning.
- Do not use "-ing" forms as nouns or adjectives, except in technical names.
- Do not use phrasal verbs. Do not use contractions.
- Use articles ("a", "the") where possible.
- Put warnings and cautions before the step they refer to.
- Identifiers use clear, simple English words. Do not use slang or unclear short forms.

## Git
- Never add a `Co-Authored-By` trailer (or any AI attribution line) to a commit message or a pull request.

## Code style
- Keep code simple. Write the least code that does the job correctly.
- Prefer the standard library and platform APIs. Add a dependency only when it removes real work.
- Match the comment density and idiom of the code around it.

## Resource use
- The server runs on a home machine. Keep memory and CPU use low at idle and under load.
- Do not poll when an event is available. Close unused connections, timers and media tracks.
- Keep client bundle size small. Load heavy parts (crypto WASM, emoji data, voice) only when needed.
- Keep container images small (multi-stage builds, slim or alpine bases).

## Portability
- One command must install and start the full stack: `docker compose up -d` with a `.env` file.
- Put all host-specific values in `.env` (domain, ports, secrets). Supply `.env.example`.
- Do not hard-code paths, hosts or OS-specific commands. Scripts must work on Windows, macOS and Linux.
- Pin tool versions (`.nvmrc`, `packageManager` in package.json, `rust-toolchain.toml`).
