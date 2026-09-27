# crypto-wasm

This package wraps vodozemac (Olm and Megolm) for the browser.

The built files in `pkg/` are in git. Thus, you do not need Rust to build the web app.

## Change the Rust code

1. Install Rust and wasm-pack.
2. Edit `src/lib.rs`.
3. Run `cargo test`.
4. Run `pnpm build:wasm`.
5. Run `pnpm test`. This test uses the WASM file from JavaScript.
6. Commit the changed files in `pkg/`.
