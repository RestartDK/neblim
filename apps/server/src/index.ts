import { google } from "@ai-sdk/google";
import { generateObject, generateText, streamText } from "ai";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { z } from "zod";

const DEFAULT_MODEL = "gemini-2.5-flash";

const chatRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
});

const meshClassificationSchema = z.object({
  severity: z.enum(["ok", "warning", "critical"]),
  title: z.string().min(1),
  description: z.string().min(1),
  action: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const app = new Hono();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({
    name: "neblim-ai-server",
    status: "ok",
    endpoints: {
      health: "GET /health",
      chat: "POST /api/chat",
      fileSummary: "POST /api/file-summary",
      meshClassify: "POST /api/mesh-classify",
      elevenlabsConversationToken:
        "GET /api/elevenlabs/conversation-token?agentId=<agent-id>",
    },
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json();
    const { prompt, model } = chatRequestSchema.parse(body);

    const result = streamText({
      model: google(model ?? DEFAULT_MODEL),
      prompt,
    });

    return result.toTextStreamResponse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return c.json(
        { error: "Invalid request body", details: error.issues },
        400,
      );
    }

    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate text",
      },
      500,
    );
  }
});

app.post("/api/file-summary", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file");
    const promptValue = formData.get("prompt");
    const modelValue = formData.get("model");

    if (!(file instanceof File)) {
      return c.json({ error: 'A file field named "file" is required' }, 400);
    }

    const prompt =
      typeof promptValue === "string" && promptValue.length > 0
        ? promptValue
        : "Summarize the key points in this file.";
    const model =
      typeof modelValue === "string" && modelValue.length > 0
        ? modelValue
        : DEFAULT_MODEL;

    const fileData = new Uint8Array(await file.arrayBuffer());

    const result = await generateText({
      model: google(model),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "file",
              data: fileData,
              mediaType: file.type || "application/octet-stream",
            },
          ],
        },
      ],
    });

    return c.json({
      text: result.text,
      model,
      fileName: file.name,
      mediaType: file.type || null,
    });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to summarize file",
      },
      500,
    );
  }
});

app.post("/api/mesh-classify", async (c) => {
  try {
    const requestStartedAt = Date.now();
    const formData = await c.req.formData();
    const image = formData.get("image");
    const metaValue = formData.get("meta");
    const modelValue = formData.get("model");

    if (!(image instanceof File)) {
      return c.json({ error: 'An image field named "image" is required' }, 400);
    }

    if (image.type && !image.type.startsWith("image/")) {
      return c.json({ error: "The uploaded file must be an image" }, 400);
    }

    let meta: unknown = null;
    if (typeof metaValue === "string" && metaValue.length > 0) {
      try {
        meta = JSON.parse(metaValue);
      } catch {
        return c.json({ error: "The meta field must be valid JSON" }, 400);
      }
    }

    const model =
      typeof modelValue === "string" && modelValue.length > 0
        ? modelValue
        : DEFAULT_MODEL;

    console.log("[mesh-classify] Request received", {
      model,
      fileName: image.name,
      mediaType: image.type || "image/jpeg",
      fileSizeBytes: image.size,
    });

    const imageData = new Uint8Array(await image.arrayBuffer());

    const promptParts: Array<{ type: "text"; text: string }> = [
      {
        type: "text",
        text: "Given this pose mesh screenshot, classify the person's status and describe what is happening. If uncertain, pick the safest non-alarming label unless there is clear evidence of a fall or distress.",
      },
    ];

    if (meta !== null) {
      promptParts.push({
        type: "text",
        text: `Optional context metadata: ${JSON.stringify(meta)}`,
      });
    }

    const result = await generateObject({
      model: google(model),
      schema: meshClassificationSchema,
      messages: [
        {
          role: "user",
          content: [
            ...promptParts,
            {
              type: "file",
              data: imageData,
              mediaType: image.type || "image/jpeg",
            },
          ],
        },
      ],
    });

    console.log("[mesh-classify] AI classification complete", {
      model,
      severity: result.object.severity,
      title: result.object.title,
      confidence: result.object.confidence,
      durationMs: Date.now() - requestStartedAt,
    });

    return c.json(result.object);
  } catch (error) {
    console.error("[mesh-classify] Classification failed", {
      error: error instanceof Error ? error.message : String(error),
    });

    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to classify mesh image",
      },
      500,
    );
  }
});

app.get("/api/elevenlabs/conversation-token", async (c) => {
  try {
    const agentId = c.req.query("agentId")?.trim();

    if (!agentId) {
      return c.json({ error: "Query parameter agentId is required" }, 400);
    }

    const endpoint = new URL(
      "https://api.elevenlabs.io/v1/convai/conversation/token",
    );
    endpoint.searchParams.set("agent_id", agentId);

    const headers: Record<string, string> = {};
    if (Bun.env.ELEVENLABS_API_KEY) {
      headers["xi-api-key"] = Bun.env.ELEVENLABS_API_KEY;
    }

    const response = await fetch(endpoint, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      const details = await response.text();
      return c.json(
        {
          error: "Failed to fetch ElevenLabs conversation token",
          upstreamStatus: response.status,
          details,
        },
        502,
      );
    }

    const payload = (await response.json()) as { token?: unknown };
    if (typeof payload.token !== "string" || payload.token.length === 0) {
      return c.json(
        { error: "ElevenLabs response did not include a token" },
        502,
      );
    }

    return c.json({ token: payload.token });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to issue conversation token",
      },
      500,
    );
  }
});

const port = Number(Bun.env.PORT ?? 8001);

Bun.serve({
  fetch: app.fetch,
  port,
});

console.log(`AI server listening on http://localhost:${port}`);

export { app };
