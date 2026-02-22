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
- `bun run dev --filter=ingest` auto-loads `apps/ingest/.env` if present.
- If no ESP32 is configured, you should only see startup logs and request logs.
- CSI packet logs + synthetic presence require `WIFI_DENSEPOSE_ESP32_PORT`.
- See `apps/ingest/.env.example` for optional runtime variables.
