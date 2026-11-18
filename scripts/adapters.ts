import type { Machine } from "../shared/model";
export type Interval = { machineId: number; start: number; end: number };
export function machines(raw: unknown, config: unknown): Machine[] {
  if (!Array.isArray(raw) || !Array.isArray(config))
    throw new Error("machine-schema");
  const ids = new Set(raw.map((r) => r?.id ?? r?.machine_id));
  const seen = new Set<number>();
  return config.map((c) => {
    if (
      !c ||
      !Number.isInteger(c.id) ||
      !ids.has(c.id) ||
      seen.has(c.id) ||
      !["wash", "dry"].includes(c.kind) ||
      !Number.isInteger(c.duration) ||
      c.duration < 5 ||
      c.duration > 240 ||
      c.duration % 5 !== 0 ||
      typeof c.enabled !== "boolean"
    )
      throw new Error("machine-config");
    seen.add(c.id);
    // A proibição explícita da API sempre prevalece; ocupação atual nunca bloqueia o futuro.
    const actual = raw.find((r) => (r.id ?? r.machine_id) === c.id);
    return {
      id: c.id,
      kind: c.kind,
      duration: c.duration,
      enabled:
        c.enabled &&
        actual.allow_scheduling !== false &&
        actual.allow_scheduling !== 0,
    };
  });
}
export function intervals(raw: unknown): Interval[] {
  if (!Array.isArray(raw)) throw new Error("interval-schema");
  return raw.map((r) => {
    if (
      !r ||
      !Number.isInteger(r.machine_id) ||
      typeof r.start !== "string" ||
      typeof r.end !== "string" ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(r.start) ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(r.end)
    )
      throw new Error("interval-schema");
    const start = Date.parse(r.start),
      end = Date.parse(r.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      throw new Error("interval-schema");
    return { machineId: r.machine_id, start, end };
  });
}
export function available(raw: unknown, id: number): boolean | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw.filter((r) => r?.machine_id === id);
  return rows.length === 1 && typeof rows[0].available === "boolean"
    ? rows[0].available
    : undefined;
}
export const overlaps = (
  list: Interval[],
  id: number,
  start: number,
  end: number,
) => list.some((i) => i.machineId === id && i.start < end && i.end > start);
