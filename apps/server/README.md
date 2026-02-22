# Server (Bun + Hono + AI SDK)

## Requirements

- Bun 1.3+
- `GOOGLE_GENERATIVE_AI_API_KEY` in your environment

## Install

```sh
bun install
```

## Run

```sh
bun run dev
```

The server runs on `http://localhost:8001` by default (`PORT` can override it).

## Endpoints

- `GET /health`
- `POST /api/chat` (streams plain text)
- `POST /api/file-summary` (multipart form upload with a `file` field)

## Example requests

```sh
curl -X POST http://localhost:8001/api/chat \
  -H "content-type: application/json" \
  -d '{"prompt":"Write a haiku about Bun and Hono."}'
```

```sh
curl -X POST http://localhost:8001/api/file-summary \
  -F "file=@./sample.pdf" \
  -F "prompt=Summarize this document in five bullets."
```
