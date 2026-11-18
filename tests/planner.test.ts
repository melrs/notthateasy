import { describe, it, expect } from "vitest";
import {
  addDate,
  dateSP,
  groupSlots,
  iso,
  lead,
  plan,
  starts,
  type Machine,
  type Observation,
} from "../shared/model";
const now = Date.parse(iso("2030-01-01", "08:00"));
const catalog: Machine[] = [
  { id: 1, kind: "wash", duration: 60, enabled: true },
  { id: 2, kind: "dry", duration: 60, enabled: true },
];
const obs = (
  id: number,
  date: string,
  time: string,
  state: Observation["state"] = "free",
): Observation => ({
  machineId: id,
  start: new Date(iso(date, time)).toISOString(),
  state,
  reason: state === "free" ? "Livre no snapshot" : "Não confirmado",
  checkedAt: new Date(now).toISOString(),
});
const slot = (
  date: string,
  time: string,
  observations: Observation[],
  mode: "pair" | "wash" | "dry" = "pair",
  transfer = 0,
  m = catalog,
  n = now,
) =>
  plan(date, mode, m, observations, transfer, n).find(
    (s) => Date.parse(s.start) === Date.parse(iso(date, time)),
  )!;
describe("agenda", () => {
  it("gera 288 inícios de 5 min no fuso de São Paulo", () => {
    const a = starts("2030-01-01");
    expect(a).toHaveLength(288);
    expect(dateSP(Date.parse(a[0]))).toBe("2030-01-01");
    expect(Date.parse(a[1]) - Date.parse(a[0])).toBe(300000);
    expect(addDate("2030-12-31", 1)).toBe("2031-01-01");
  });
  it("exige ambas as etapas livres", () => {
    expect(
      slot("2030-01-01", "09:00", [obs(1, "2030-01-01", "09:00")]).state,
    ).toBe("unknown");
    expect(
      slot("2030-01-01", "09:00", [
        obs(1, "2030-01-01", "09:00"),
        obs(2, "2030-01-01", "10:00"),
      ]).state,
    ).toBe("free");
  });
  it("aplica transferência configurável", () => {
    const a = [obs(1, "2030-01-01", "09:00"), obs(2, "2030-01-01", "10:05")];
    expect(slot("2030-01-01", "09:00", a, "pair", 5).options[0].end).toBe(
      new Date(iso("2030-01-01", "11:05")).toISOString(),
    );
    expect(slot("2030-01-01", "09:00", a).state).toBe("unknown");
  });
  it("trata seca e conclusão no dia seguinte", () => {
    const a = [obs(1, "2030-01-01", "23:30"), obs(2, "2030-01-02", "00:30")];
    expect(slot("2030-01-01", "23:30", a).options[0].end).toBe(
      new Date(iso("2030-01-02", "01:30")).toISOString(),
    );
  });
  it("aplica antecedência na fronteira exata", () => {
    expect(
      slot("2030-01-01", "08:55", [obs(1, "2030-01-01", "08:55")], "wash")
        .state,
    ).toBe("busy");
    expect(
      slot("2030-01-01", "09:00", [obs(1, "2030-01-01", "09:00")], "wash")
        .state,
    ).toBe("free");
    expect(lead(75)).toBe(85);
    const m = [{ ...catalog[0], duration: 75 }];
    expect(
      slot("2030-01-01", "09:20", [obs(1, "2030-01-01", "09:20")], "wash", 0, m)
        .state,
    ).toBe("busy");
    expect(
      slot("2030-01-01", "09:25", [obs(1, "2030-01-01", "09:25")], "wash", 0, m)
        .state,
    ).toBe("free");
  });
  it("antecedência considera também a seca longa", () => {
    const m = [catalog[0], { ...catalog[1], duration: 240 }];
    expect(
      slot(
        "2030-01-01",
        "09:00",
        [obs(1, "2030-01-01", "09:00"), obs(2, "2030-01-01", "10:00")],
        "pair",
        0,
        m,
      ).state,
    ).toBe("busy");
  });
  it("não confirma snapshots vencidos", () =>
    expect(
      slot(
        "2030-01-01",
        "12:00",
        [obs(1, "2030-01-01", "12:00")],
        "wash",
        0,
        catalog,
        now + 76 * 60000,
      ).state,
    ).toBe("unknown"));
  it("ignora máquina sem agendamento", () =>
    expect(
      slot("2030-01-01", "09:00", [obs(1, "2030-01-01", "09:00")], "wash", 0, [
        { ...catalog[0], enabled: false },
      ]).state,
    ).toBe("unknown"));
  it("um bloqueio conhecido torna o par indisponível mesmo se a outra etapa for desconhecida", () =>
    expect(
      slot("2030-01-01", "09:00", [obs(1, "2030-01-01", "09:00", "busy")])
        .state,
    ).toBe("busy"));
  it("agrupa somente inícios consecutivos do mesmo estado", () => {
    const a = plan("2030-01-01", "wash", catalog, [], 0, now);
    const g = groupSlots(a);
    expect(g.reduce((n, w) => n + w.length, 0)).toBe(288);
    expect(g).toHaveLength(2);
  });
});
