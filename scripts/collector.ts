import {
  addDate,
  dateSP,
  iso,
  starts,
  type Day,
  type Machine,
  type Observation,
} from "../shared/model";
import {
  available,
  intervals,
  machines,
  overlaps,
  type Interval,
} from "./adapters";
import type { Client } from "./client";
export type Collection = { machines: Machine[]; days: Day[]; partial: boolean };
export async function collect(
  client: Client,
  building: number,
  config: unknown,
  contract: string,
  offset = 0,
  time = "09:00",
  now = Date.now(),
): Promise<Collection> {
  if (
    !["unverified", "day-v1", "cycle-v1"].includes(contract) ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 6 ||
    !/^([01]\d|2[0-3]):[0-5][05]$/.test(time)
  )
    throw new Error("config-invalid");
  const catalog = machines(
    await client.get(`/machines/building/${building}`),
    config,
  );
  const days: Day[] = Array.from({ length: 8 }, (_, i) => ({
    date: addDate(dateSP(now), i),
    observations: [],
    warnings: [],
  }));
  const checkedAt = new Date(now).toISOString();
  const usable = catalog.filter((m) => m.enabled);
  let partial = contract === "unverified" || usable.length === 0;
  const safeIntervals = async (path: string) => {
    try {
      return intervals(await client.get(path));
    } catch {
      partial = true;
      return undefined;
    }
  };
  const blocked = new Map<string, Promise<Interval[] | undefined>>();
  const getBlocked = (date: string) => {
    if (!blocked.has(date))
      blocked.set(
        date,
        safeIntervals(`/schedules/slots-bloqueados/${building}?date=${date}`),
      );
    return blocked.get(date)!;
  };
  if (contract === "day-v1") {
    const calendar = new Map<
      string,
      { blocked?: Interval[]; maintenance?: Interval[] }
    >();
    for (const day of days) {
      const b = await getBlocked(day.date);
      const m = await safeIntervals(
        `/manutencao-programada/ativas/building/${building}?date=${day.date}&time=00:00`,
      );
      calendar.set(day.date, { blocked: b, maintenance: m });
    }
    for (const day of days)
      for (const start of starts(day.date))
        for (const machine of usable) {
          const t = Date.parse(start),
            end = t + machine.duration * 60000;
          const endDate = dateSP(end - 1);
          const a = calendar.get(day.date),
            b = calendar.get(endDate);
          const known =
            a?.blocked && a.maintenance && b?.blocked && b.maintenance;
          const busy = overlaps(
            [...(a?.blocked || []), ...(b?.blocked || [])],
            machine.id,
            t,
            end,
          );
          const maintenance = overlaps(
            [...(a?.maintenance || []), ...(b?.maintenance || [])],
            machine.id,
            t,
            end,
          );
          day.observations.push({
            start,
            machineId: machine.id,
            state: maintenance || busy ? "busy" : known ? "free" : "unknown",
            reason: maintenance
              ? "Manutenção"
              : busy
                ? "Ocupado"
                : known
                  ? "Livre no snapshot"
                  : "Não confirmado",
            checkedAt,
          });
        }
  } else if (contract === "cycle-v1") {
    const date = days[offset].date;
    const from = Date.parse(iso(date, time));
    const points = new Set<number>();
    for (let i = 0; i < 6; i++) {
      const t = from + i * 300000;
      points.add(t);
      for (const w of usable.filter((m) => m.kind === "wash"))
        points.add(t + w.duration * 60000);
    }
    for (const t of [...points].sort((a, b) => a - b)) {
      const date = dateSP(t),
        clock = new Date(t - 3 * 3600000).toISOString().slice(11, 16);
      const day = days.find((d) => d.date === date);
      if (!day) continue;
      let raw: unknown;
      try {
        raw = await client.get(
          `/schedules/maquinas-disponiveis/${building}?date=${date}&hora=${clock}`,
        );
      } catch {
        partial = true;
      }
      const maintenance = await safeIntervals(
        `/manutencao-programada/ativas/building/${building}?date=${date}&time=${clock}`,
      );
      const b = await getBlocked(date);
      for (const machine of usable) {
        const end = t + machine.duration * 60000;
        const next = dateSP(end - 1);
        const bn = next === date ? b : await getBlocked(next);
        const m = maintenance && overlaps(maintenance, machine.id, t, end);
        const occupied =
          (b && overlaps(b, machine.id, t, end)) ||
          (bn && overlaps(bn, machine.id, t, end));
        const avail = available(raw, machine.id);
        const known =
          maintenance !== undefined &&
          b !== undefined &&
          bn !== undefined &&
          avail !== undefined;
        const state =
          m || occupied || avail === false
            ? "busy"
            : known
              ? "free"
              : "unknown";
        if (state === "unknown") partial = true;
        day.observations.push({
          start: new Date(t).toISOString(),
          machineId: machine.id,
          state,
          reason: m
            ? "Manutenção"
            : occupied || avail === false
              ? "Ocupado"
              : known
                ? "Livre no snapshot"
                : "Não confirmado",
          checkedAt,
        });
      }
    }
    partial = true; // A amostra nunca representa a cobertura do dia inteiro.
  }
  if (partial) for (const d of days) d.warnings = ["partial"];
  return { machines: catalog, days, partial };
}
export function fixture(now = Date.now()): Collection {
  const catalog: Machine[] = [
    { id: 918, kind: "wash", duration: 60, enabled: true },
    { id: 924, kind: "dry", duration: 60, enabled: true },
    { id: 999, kind: "wash", duration: 60, enabled: false },
  ];
  const days: Day[] = Array.from({ length: 8 }, (_, i) => {
    const date = addDate(dateSP(now), i);
    return {
      date,
      warnings: [],
      observations: starts(date).flatMap((start) =>
        catalog
          .filter((m) => m.enabled)
          .map((m) => {
            const t = Date.parse(start),
              end = t + m.duration * 60000;
            const blockedStart = Date.parse(
              iso(date, m.kind === "wash" ? "09:00" : "15:00"),
            );
            const blockedEnd = blockedStart + 120 * 60000;
            const busy = t < blockedEnd && end > blockedStart;
            const unconfirmedStart = Date.parse(iso(date, "19:00"));
            const unknown =
              t < unconfirmedStart + 60 * 60000 && end > unconfirmedStart;
            return {
              start,
              machineId: m.id,
              state: unknown
                ? ("unknown" as const)
                : busy
                  ? ("busy" as const)
                  : ("free" as const),
              reason: unknown
                ? "Não confirmado"
                : busy
                  ? "Ocupado"
                  : "Livre no snapshot",
              checkedAt: new Date(now).toISOString(),
            };
          }),
      ),
    };
  });
  return { machines: catalog, days, partial: true };
}
