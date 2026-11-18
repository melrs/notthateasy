import { describe, it, expect, vi } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { Client, seal, unseal, type TokenState } from "../scripts/client";
const now = Date.parse("2030-01-01T00:00:00Z");
const scope = createHash("sha256")
  .update("test@example.invalid:123")
  .digest("hex");
const state: TokenState = {
  token: "synthetic-token-never-real",
  issuedAt: now,
  expiresAt: now + 30 * 86400000,
  scope,
};
const settings = {
  email: "test@example.invalid",
  password: "synthetic-password",
  building: 123,
  maxCalls: 40,
  now: () => now,
  sleep: async () => {},
};
const login = () =>
  Response.json({
    token: "new-synthetic-token-never-real",
    user: {
      building_id: 123,
      name: "PRIVATE_SENTINEL",
      apt: "PRIVATE_SENTINEL",
    },
  });
describe("autenticação e transporte", () => {
  it("cifra e autentica o cache sem texto puro", () => {
    const key = randomBytes(32).toString("base64");
    const a = seal(state, key),
      b = seal(state, key);
    expect(a.includes(Buffer.from(state.token))).toBe(false);
    expect(a.equals(b)).toBe(false);
    expect(unseal(a, key)).toEqual(state);
    a[30] ^= 1;
    expect(unseal(a, key)).toBeUndefined();
    expect(unseal(b, randomBytes(32).toString("base64"))).toBeUndefined();
  });
  it("reutiliza token antes de 15 dias e deduplica GET", async () => {
    const fetcher = vi.fn(async () => Response.json([]));
    const c = new Client({ ...settings, state, fetcher });
    await Promise.all([
      c.get("/machines/building/123"),
      c.get("/machines/building/123"),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(c.calls).toBe(1);
  });
  it("renova automaticamente aos 15 dias", async () => {
    const fetcher = vi.fn(async () => login());
    const c = new Client({
      ...settings,
      state: { ...state, issuedAt: now - 15 * 86400000 },
      fetcher,
    });
    await c.authenticate();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(c.state?.token).toBe("new-synthetic-token-never-real");
    expect(Object.keys(c.state!).sort()).toEqual([
      "expiresAt",
      "issuedAt",
      "scope",
      "token",
    ]);
  });
  it("renova perto da expiração ou após mudança de conta", async () => {
    for (const saved of [
      { ...state, expiresAt: now + 1000 },
      { ...state, scope: "old-account" },
    ]) {
      const fetcher = vi.fn(async () => login());
      await new Client({ ...settings, state: saved, fetcher }).authenticate();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("faz login no cache ausente", async () => {
    const fetcher = vi.fn(async () => login());
    await new Client({ ...settings, fetcher }).authenticate();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("repete 401 só uma vez", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockImplementationOnce(async () => login())
      .mockResolvedValueOnce(new Response("", { status: 401 }));
    const c = new Client({ ...settings, state, fetcher });
    await expect(c.get("/machines/building/123")).rejects.toThrow(
      "autenticacao-indisponivel",
    );
    expect(c.calls).toBe(3);
    expect(c.stopped).toBe(true);
  });
  it("após 401 e login, devolve a resposta útil", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockImplementationOnce(async () => login())
      .mockResolvedValueOnce(Response.json([1]));
    const c = new Client({ ...settings, state, fetcher });
    expect(await c.get("/machines/building/123")).toEqual([1]);
  });
  it("interrompe em 429 e respeita teto de chamadas", async () => {
    const c = new Client({
      ...settings,
      state,
      fetcher: async () => new Response("", { status: 429 }),
    });
    await expect(c.get("/machines/building/123")).rejects.toThrow(
      "limite-da-api",
    );
    await expect(
      c.get("/schedules/slots-bloqueados/123?date=2030-01-01"),
    ).rejects.toThrow("limite-de-consultas");
    expect(c.calls).toBe(1);
    const d = new Client({
      ...settings,
      state,
      maxCalls: 1,
      fetcher: async () => Response.json([]),
    });
    await d.get("/machines/building/123");
    await expect(
      d.get("/schedules/slots-bloqueados/123?date=2030-01-01"),
    ).rejects.toThrow("limite-de-consultas");
  });
  it("bloqueia rotas de escrita e outro prédio", () => {
    const c = new Client({ ...settings, state });
    expect(() => c.get("/schedules/reservar")).toThrow(
      "endpoint-nao-permitido",
    );
    expect(() => c.get("/machines/building/999")).toThrow();
  });
  it("rejeita login de prédio diferente", async () => {
    const c = new Client({
      ...settings,
      fetcher: async () =>
        Response.json({ token: state.token, user: { building_id: 999 } }),
    });
    await expect(c.authenticate()).rejects.toThrow("login-invalido");
  });
  it("sanitiza erro de transporte", async () => {
    const c = new Client({
      ...settings,
      state,
      fetcher: async () => {
        throw Error("PRIVATE_SENTINEL");
      },
    });
    await expect(c.get("/machines/building/123")).rejects.toThrow(
      "falha-de-rede",
    );
  });
});
