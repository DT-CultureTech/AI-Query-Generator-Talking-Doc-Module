import request from "supertest";

import { getConfig } from "../src/config/env.js";
import { createApp } from "../src/server.js";

describe("POST /api/generate-query", () => {
  it("returns safe SQL when model output is valid", async () => {
    const app = createApp(
      getConfig({
        modelName: "mock-model",
        mockLlmResponse:
          "SELECT value, score FROM legacy_zset WHERE _key = 'topics:votes' ORDER BY score DESC LIMIT 10;"
      })
    );

    const response = await request(app)
      .post("/api/generate-query")
      .send({ input: "show top 10 topics by votes" });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.sql).toContain("legacy_zset");
    expect(response.body.sql).toContain("topics:votes");
    expect(response.body.validation.isValid).toBe(true);
  });

  it("returns SQL for active members query via model mock", async () => {
    const app = createApp(
      getConfig({
        modelName: "mock-model",
        mockLlmResponse:
          "SELECT member AS uid FROM legacy_set WHERE _key = 'organization:55:members:active' ORDER BY member;"
      })
    );

    const response = await request(app)
      .post("/api/generate-query")
      .send({ input: "Give me all active members for organization 55" });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.model).toBe("mock-model");
    expect(response.body.sql).toContain("organization:55:members:active");
  });

  it("returns SQL for session rows via model mock", async () => {
    const app = createApp(
      getConfig({
        modelName: "mock-model",
        mockLlmResponse:
          "SELECT sid, sess, expire FROM session ORDER BY expire DESC LIMIT 10;"
      })
    );

    const response = await request(app)
      .post("/api/generate-query")
      .send({ input: "list session rows sorted by expire descending limit 10" });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.sql).toContain("FROM session");
    expect(response.body.sql).toContain("ORDER BY expire DESC");
    expect(response.body.sql).toContain("LIMIT 10");
  });

  it("returns SQL for HVT experiments query via model mock", async () => {
    const app = createApp(
      getConfig({
        modelName: "mock-model",
        mockLlmResponse:
          "SELECT value AS experiment_id, score AS created_at FROM legacy_zset WHERE _key = 'hvt:experiments:org:123:sorted' ORDER BY score DESC;"
      })
    );

    const response = await request(app)
      .post("/api/generate-query")
      .send({ input: "List all experiments for organization 123 ordered by newest first" });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.sql).toContain("hvt:experiments:org:123:sorted");
  });

  it("returns SQL for HVT active experiments status query via model mock", async () => {
    const app = createApp(
      getConfig({
        modelName: "mock-model",
        mockLlmResponse:
          "SELECT member AS experiment_id FROM legacy_set WHERE _key = 'hvt:experiments:status:active';"
      })
    );

    const response = await request(app)
      .post("/api/generate-query")
      .send({ input: "Show all active HVT experiments" });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.sql).toContain("hvt:experiments:status:active");
  });

  it("rejects unsafe model output", async () => {
    const app = createApp(
      getConfig({
        modelName: "mock-model",
        mockLlmResponse: "DELETE FROM legacy_hash WHERE _key = 'user:123';"
      })
    );

    const response = await request(app)
      .post("/api/generate-query")
      .send({ input: "delete user" });

    expect(response.status).toBe(422);
    expect(response.body.ok).toBe(false);
    expect(response.body.message).toContain("failed safety checks");
  });

  it("rejects model output using unknown tables", async () => {
    const app = createApp(
      getConfig({
        modelName: "mock-model",
        mockLlmResponse: "SELECT * FROM users WHERE id = 1;"
      })
    );

    const response = await request(app)
      .post("/api/generate-query")
      .send({ input: "get user by id" });

    expect(response.status).toBe(422);
    expect(response.body.ok).toBe(false);
  });

  it("returns 503 when ollama runtime is unavailable", async () => {
    const app = createApp(
      getConfig({
        ollamaBaseUrl: "http://127.0.0.1:1",
        autoPullModel: false,
        modelTimeoutMs: 500
      })
    );

    const response = await request(app)
      .post("/api/generate-query")
      .send({ input: "show all live object keys from legacy object live view" });

    expect(response.status).toBe(503);
    expect(response.body.ok).toBe(false);
    expect(response.body.message).toContain("Cannot connect to Ollama");
  });
});
