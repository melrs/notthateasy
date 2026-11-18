import { it, expect, describe } from "vitest";
import { machines, intervals, available, overlaps } from "../scripts/adapters";
import { collect, fixture } from "../scripts/collector";
import { Client } from "../scripts/client";
import { anonymize, validatePublic } from "../scripts/privacy";
import { dateSP, iso, type Manifest } from "../shared/model";
const now = Date.parse(iso("2030-01-01", "08:00"));
const config = [
  { id: 7001, kind: "wash", duration: 60, enabled: true },
  { id: 7002, kind: "dry", duration: 60, enabled: true },
];
function client(maintenance: unknown = [], blocked: unknown = []) {
  return new Client({
    email: "test@example.invalid",
    password: "fake",
    building: 123,
    maxCalls: 40,
    now: () => now,
    sleep: async () => {},
    fetcher: async (input) => {
      const path = String(input);
      if (path.endsWith("/login"))
        return Response.json({
          token: "synthetic-token-never-real",
          user: { building_id: 123 },
        });
      if (path.includes("/machines/"))
        return Response.json([
          { id: 7001, status: "in_use", name: "PRIVATE_SENTINEL" },
          { id: 7002, apartment: "PRIVATE_SENTINEL" },
        ]);
      return Response.json(
        path.includes("manutencao")
          ? maintenance
          : path.includes("maquinas-disponiveis")
            ? [
                { machine_id: 7001, available: true },
                { machine_id: 7002, available: true },
              ]
            : blocked,
      );
    },
  });
}
describe("adaptação conservadora", () => {
  it("distingue ocupação atual de permissão de agendamento", () => {
    expect(
      machines(
        [
          { id: 7001, status: "busy" },
          { id: 7002, allow_scheduling: false },
        ],
        config,
      ).map((m) => m.enabled),
    ).toEqual([true, false]);
  });
  it("rejeita configurações e intervalos ambíguos", () => {
    expect(() => machines([{ id: 7001 }], config)).toThrow();
    expect(() =>
      intervals([
        { machine_id: 1, start: "2030-01-01T10:00", end: "2030-01-01T11:00" },
      ]),
    ).toThrow();
    expect(
      available([{ machine_id: 1, available: "true" }], 1),
    ).toBeUndefined();
  });
  it("não bloqueia fronteira sem sobreposição", () => {
    const a = intervals([
      {
        machine_id: 1,
        start: iso("2030-01-01", "09:00"),
        end: iso("2030-01-01", "10:00"),
      },
    ]);
    expect(
      overlaps(
        a,
        1,
        Date.parse(iso("2030-01-01", "10:00")),
        Date.parse(iso("2030-01-01", "11:00")),
      ),
    ).toBe(false);
  });
  it("calendário diário completo custa 18 chamadas com login", async () => {
    const c = client();
    const r = await collect(c, 123, config, "day-v1", 0, "09:00", now);
    expect(c.calls).toBe(18);
    expect(r.days).toHaveLength(8);
    expect(r.days[0].observations).toHaveLength(576);
    expect(r.days[0].observations.every((o) => o.state === "free")).toBe(true);
    expect(r.days[7].observations.at(-1)?.state).toBe("unknown");
  });
  it("schema de manutenção desconhecido nunca vira livre", async () => {
    const r = await collect(
      client({ unexpected: true }),
      123,
      config,
      "day-v1",
      0,
      "09:00",
      now,
    );
    expect(r.partial).toBe(true);
    expect(r.days[0].observations.every((o) => o.state === "unknown")).toBe(
      true,
    );
  });
  it("bloqueia ciclo que atravessa manutenção após meia-noite", async () => {
    const maint = [
      {
        machine_id: 7001,
        start: iso("2030-01-02", "00:00"),
        end: iso("2030-01-02", "00:15"),
      },
    ];
    const r = await collect(
      client(maint),
      123,
      config,
      "day-v1",
      0,
      "09:00",
      now,
    );
    expect(
      r.days[0].observations.find(
        (o) =>
          o.machineId === 7001 &&
          Date.parse(o.start) === Date.parse(iso("2030-01-01", "23:30")),
      )?.reason,
    ).toBe("Manutenção");
  });
  it("modo não validado não dispara varredura", async () => {
    const c = client();
    const r = await collect(c, 123, config, "unverified", 0, "09:00", now);
    expect(c.calls).toBe(2);
    expect(r.days.flatMap((d) => d.observations)).toHaveLength(0);
  });
  it("modo por ciclo consulta uma única janela e é parcial", async () => {
    const c = client();
    const r = await collect(c, 123, config, "cycle-v1", 0, "09:00", now);
    expect(c.calls).toBeLessThanOrEqual(40);
    expect(r.partial).toBe(true);
    expect(r.days[0].observations).toHaveLength(24);
    expect(r.days[1].observations).toHaveLength(0);
  });
  it("teto deixa resultados desconhecidos em vez de fabricar livre", async () => {
    const c = client();
    (c as any).s.maxCalls = 3;
    const r = await collect(c, 123, config, "day-v1", 0, "09:00", now);
    expect(c.calls).toBe(3);
    expect(r.days[0].observations.every((o) => o.state === "unknown")).toBe(
      true,
    );
  });
});
describe("privacidade", () => {
  function data() {
    const f = fixture(now);
    const a = anonymize(f.machines, f.days);
    const m: Manifest = {
      version: 1,
      generatedAt: new Date(now).toISOString(),
      demo: true,
      machines: a.machines,
      dates: a.days.slice(0, 7).map((d) => d.date),
      files: Object.fromEntries(
        a.days.map((d) => [d.date, `day-${d.date}.json`]),
      ),
      calls: 0,
      warnings: ["Demonstração fictícia."],
    };
    return { m, days: a.days };
  }
  it("publica categorias agregadas sem IDs reais ou máquinas desabilitadas", () => {
    const a = anonymize(
      [
        { id: 81234, kind: "wash", duration: 60, enabled: true },
        { id: 81235, kind: "wash", duration: 60, enabled: true },
      ],
      [],
    );
    expect(a.machines).toEqual([
      { id: 1, kind: "wash", duration: 60, enabled: true },
    ]);
    expect(JSON.stringify(a)).not.toContain("81234");
  });
  it("rejeita qualquer campo extra, mesmo em objeto aninhado", () => {
    const a = data();
    validatePublic(a.m, a.days);
    (a.m as any).address = "PRIVATE_SENTINEL";
    expect(() => validatePublic(a.m, a.days)).toThrow("privacy-fields");
    const b = data();
    (b.days[0].observations[0] as any).apartment = "PRIVATE_SENTINEL";
    expect(() => validatePublic(b.m, b.days)).toThrow("privacy-fields");
  });
  it("rejeita razões livres vindas do upstream", () => {
    const a = data();
    a.days[0].observations[0].reason = "PRIVATE_SENTINEL";
    expect(() => validatePublic(a.m, a.days)).toThrow();
  });
  it("nenhum dado de identificação recebido chega ao produto", async () => {
    const c = client();
    const r = await collect(c, 123, config, "day-v1", 0, "09:00", now);
    const a = anonymize(r.machines, r.days);
    const serialized = JSON.stringify(a);
    expect(serialized).not.toContain("PRIVATE_SENTINEL");
    expect(serialized).not.toContain("7001");
    expect(serialized).not.toContain("building");
  });
  it("não confirma grupo quando falta uma máquina e nenhuma outra está livre", () => {
    const a = anonymize(
      [
        { id: 1, kind: "wash", duration: 60, enabled: true },
        { id: 2, kind: "wash", duration: 60, enabled: true },
      ],
      [
        {
          date: dateSP(now),
          warnings: [],
          observations: [
            {
              start: new Date(now).toISOString(),
              machineId: 1,
              state: "busy",
              reason: "Ocupado",
              checkedAt: new Date(now).toISOString(),
            },
          ],
        },
      ],
    );
    expect(a.days[0].observations[0].state).toBe("unknown");
  });
});
