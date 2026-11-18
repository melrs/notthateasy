import type { Machine } from "../shared/model";
export type Interval = { machineId: number; start: number; end: number };
const normalize = (value: unknown) => typeof value === 'string'
  ? value.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  : '';
const washWords = /(?:^|[^a-z])(?:wash(?:er|ing)?|lava(?:dora|r|gem)?|lavadora)(?:$|[^a-z])/;
const dryWords = /(?:^|[^a-z])(?:dry(?:er|ing)?|seca(?:dora|r|gem)?)(?:$|[^a-z])/;
export function catalogKind(value: unknown): Machine['kind'] | undefined {
  if (!value || typeof value !== 'object') return;
  const row = value as Record<string, unknown>;
  const verdict = (s: string) => {
    const w = washWords.test(s), d = dryWords.test(s);
    return {w,d};
  };
  const type = verdict(normalize(row.type));
  const label = verdict(normalize(row.name ?? row.nome ?? row.machine_name ?? row.nome_maquina));
  if ((type.w || label.w) && (type.d || label.d)) return;
  return type.w || label.w ? 'wash' : type.d || label.d ? 'dry' : undefined;
}
const explicitlyDisabled = (row: { allow_scheduling?: unknown; permite_agendamento?: unknown }) =>
  row.allow_scheduling === false || row.allow_scheduling === 0 ||
  row.permite_agendamento === false || row.permite_agendamento === 0;
export function machines(raw: unknown, config: unknown): Machine[] {
  if (!Array.isArray(raw) || (config !== null && !Array.isArray(config)))
    throw new Error("machine-schema");
  if (config === null) {
    // Catalog-derived mode admits only explicit scheduling permission and an unambiguous type.
    const rows = raw.flatMap((row): Machine[] => {
      const kind = catalogKind(row);
      if (!row || !kind || !Number.isSafeInteger(row.id) || row.id < 1 || explicitlyDisabled(row) ||
        (row.permite_agendamento !== 1 && row.permite_agendamento !== true)) return [];
      return [{ id: row.id, kind, duration:60, enabled:true }];
    });
    if (new Set(rows.map(row=>row.id)).size !== rows.length) throw new Error('machine-schema');
    return rows;
  }
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
        c.enabled && !explicitlyDisabled(actual),
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

export function pointMaintenance(value: unknown, id: number): boolean | undefined {
  if (!value || typeof value !== 'object' || !('machine_ids' in value) ||
    !Array.isArray(value.machine_ids) || !value.machine_ids.every(x => Number.isSafeInteger(x) && x > 0)) return;
  return value.machine_ids.includes(id);
}
