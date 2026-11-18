import type { Day, Machine, Manifest, Observation } from "../shared/model";
const REASONS = new Set([
  "Livre no snapshot",
  "Ocupado",
  "Indisponível na Foreasy",
  "Início indicado pela Foreasy; ciclo não confirmado",
  "Manutenção",
  "Não confirmado",
  "Limite de consultas",
  "Falha de consulta",
]);
export function anonymize(machines: Machine[], days: Day[]) {
  const groups = [
    ...new Set(
      machines.filter((m) => m.enabled).map((m) => `${m.kind}:${m.duration}`),
    ),
  ].sort();
  const catalog = groups.map((g, i) => {
    const [kind, duration] = g.split(":");
    return {
      id: i + 1,
      kind: kind as Machine["kind"],
      duration: Number(duration),
      enabled: true,
    };
  });
  return {
    machines: catalog,
    days: days.map((d) => {
      const observations: Observation[] = [];
      for (const m of catalog) {
        const ids = new Set(
          machines
            .filter(
              (x) =>
                x.enabled && x.kind === m.kind && x.duration === m.duration,
            )
            .map((x) => x.id),
        );
        const byStart = new Map<string, Observation[]>();
        for (const o of d.observations)
          if (ids.has(o.machineId)) {
            const list = byStart.get(o.start) || [];
            list.push(o);
            byStart.set(o.start, list);
          }
        for (const [start, list] of byStart) {
          const free = list.find((o) => o.state === "free");
          const complete =
            new Set(list.map((o) => o.machineId)).size === ids.size;
          const uncertain = list.find((o) => o.state === "unknown");
          const tentative = list.some((o) => o.state === "unknown" && o.reason === "Início indicado pela Foreasy; ciclo não confirmado");
          const source = free || uncertain || list[0];
          observations.push({
            start,
            machineId: m.id,
            state: free ? "free" : complete && !uncertain ? "busy" : "unknown",
            reason: free
              ? "Livre no snapshot"
              : complete && !uncertain
                ? source.reason
                : tentative
                  ? "Início indicado pela Foreasy; ciclo não confirmado"
                  : "Não confirmado",
            checkedAt: list.map((o) => o.checkedAt).sort()[0],
          });
        }
      }
      return {
        date: d.date,
        observations,
        warnings: d.warnings
          .map(() => "Alguns horários não puderam ser confirmados.")
          .slice(0, 1),
      };
    }),
  };
}
function exact(o: unknown, keys: string[]) {
  if (
    !o ||
    typeof o !== "object" ||
    Array.isArray(o) ||
    Object.keys(o).sort().join() !== keys.sort().join()
  )
    throw new Error("privacy-fields");
}
const stamp = (v: unknown) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v));
const day = (v: unknown) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export function validatePublic(manifest: Manifest, days: Day[]) {
  exact(manifest, [
    "version",
    "generatedAt",
    "demo",
    "machines",
    "dates",
    "files",
    "calls",
    "warnings",
  ]);
  if (
    manifest.version !== 1 ||
    !stamp(manifest.generatedAt) ||
    typeof manifest.demo !== "boolean" ||
    !Number.isInteger(manifest.calls) ||
    manifest.calls < 0 ||
    manifest.calls > 60
  )
    throw new Error("privacy-manifest");
  if (
    manifest.warnings.some(
      (w) =>
        ![
          "Dados não confirmados: contrato da API pendente.",
          "Consulta parcial: confira os horários não confirmados.",
          "Demonstração fictícia.",
        ].includes(w),
    )
  )
    throw new Error("privacy-warning");
  manifest.machines.forEach((m, i) => {
    exact(m, ["id", "kind", "duration", "enabled"]);
    if (
      m.id !== i + 1 ||
      !["wash", "dry"].includes(m.kind) ||
      !Number.isInteger(m.duration) ||
      m.duration < 5 ||
      m.duration > 240 ||
      m.enabled !== true
    )
      throw new Error("privacy-machine");
  });
  if (
    manifest.dates.length !== 7 ||
    manifest.dates.some((d) => !day(d)) ||
    Object.keys(manifest.files).length !== 8
  )
    throw new Error("privacy-dates");
  for (const [d, file] of Object.entries(manifest.files))
    if (!day(d) || file !== `day-${d}.json`) throw new Error("privacy-path");
  for (const d of days) {
    exact(d, ["date", "observations", "warnings"]);
    if (
      !day(d.date) ||
      !manifest.files[d.date] ||
      d.warnings.some(
        (w) => w !== "Alguns horários não puderam ser confirmados.",
      )
    )
      throw new Error("privacy-day");
    for (const o of d.observations) {
      exact(o, ["start", "machineId", "state", "reason", "checkedAt"]);
      if (
        !stamp(o.start) ||
        !stamp(o.checkedAt) ||
        !manifest.machines.some((m) => m.id === o.machineId) ||
        !["free", "busy", "unknown"].includes(o.state) ||
        !REASONS.has(o.reason)
      )
        throw new Error("privacy-observation");
    }
  }
}
