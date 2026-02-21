import { google } from "@ai-sdk/google";
import { generateText, streamText } from "ai";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { z } from "zod";

const DEFAULT_MODEL = "gemini-2.5-flash";

const chatRequestSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().min(1).optional(),
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

const port = Number(Bun.env.PORT ?? 8000);

Bun.serve({
  fetch: app.fetch,
  port,
});

console.log(`AI server listening on http://localhost:${port}`);

export { app };
