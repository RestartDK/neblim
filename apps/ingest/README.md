# ingest

This app contains the Rust ingestion/server workspace copied from `wifi-densepose`.

## Scripts

- `bun run dev --filter=ingest` - run `wifi-densepose-server`
- `bun run build --filter=ingest` - compile check server crate
- `bun run check-types --filter=ingest` - compile check Rust workspace
- `bun run lint --filter=ingest` - run `cargo fmt --check`

## Notes

- The workspace entrypoint is `Cargo.toml` in this folder.
- Runtime server defaults to `127.0.0.1:8787`.
