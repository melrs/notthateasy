export const ZONE = "America/Sao_Paulo";
export type Kind = "wash" | "dry";
export type Mode = Kind | "pair";
export type State = "free" | "busy" | "unknown";
export type SlotState = State | "reported";
export const REPORTED_START = "Início indicado pela Foreasy; ciclo não confirmado";
export type Machine = {
  id: number;
  kind: Kind;
  duration: number;
  enabled: boolean;
};
export type Observation = {
  start: string;
  machineId: number;
  state: State;
  reason: string;
  checkedAt: string;
};
export type Day = {
  date: string;
  observations: Observation[];
  warnings: string[];
};
export type Manifest = {
  version: 1;
  generatedAt: string;
  demo: boolean;
  machines: Machine[];
  dates: string[];
  files: Record<string, string>;
  calls: number;
  warnings: string[];
};
export type Option = { wash?: number; dry?: number; end: string };
export type Slot = {
  start: string;
  state: SlotState;
  reason: string;
  options: Option[];
};
export const iso = (date: string, time = "00:00") => `${date}T${time}:00-03:00`;
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const clockFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
});
export function dateSP(value: Date | number = new Date()) {
  return dateFormatter.format(value);
}
export function addDate(date: string, days: number) {
  return dateSP(new Date(Date.parse(iso(date)) + days * 86400000));
}
export function clock(value: string | number) {
  return clockFormatter.format(new Date(value));
}
export function starts(date: string) {
  return Array.from({ length: 288 }, (_, i) =>
    new Date(Date.parse(iso(date)) + i * 300000).toISOString(),
  );
}
export const lead = (duration: number) => (duration > 60 ? duration + 10 : 60);
export function plan(
  date: string,
  mode: Mode,
  machines: Machine[],
  observations: Observation[],
  transfer = 0,
  now = Date.now(),
): Slot[] {
  const index = new Map(
    observations.map((o) => [`${o.machineId}:${Date.parse(o.start)}`, o]),
  );
  const eligible = machines.filter((m) => m.enabled);
  const check = (m: Machine, t: number): { state: SlotState; reason: string } => {
    if (t < now + lead(m.duration) * 60000)
      return { state: "busy", reason: "Antecedência mínima" };
    const o = index.get(`${m.id}:${t}`);
    if (!o) return { state: "unknown", reason: "Horário não consultado" };
    if (
      now - Date.parse(o.checkedAt) > 75 * 60000 ||
      Date.parse(o.checkedAt) > now + 60000
    )
      return { state: "unknown", reason: "Snapshot vencido" };
    return o.state === "unknown" && o.reason === REPORTED_START ? { state: "reported", reason: REPORTED_START } : o;
  };
  return starts(date).map((start) => {
    const t = Date.parse(start);
    const options: Option[] = [];
    const reportedOptions: Option[] = [];
    let uncertain = false;
    const reasons = new Set<string>();
    const first = eligible.filter(
      (m) => m.kind === (mode === "dry" ? "dry" : "wash"),
    );
    if (!first.length)
      return {
        start,
        state: "unknown",
        reason: "Máquinas ainda não validadas",
        options,
      };
    for (const a of first) {
      const ca = check(a, t);
      if (mode !== "pair") {
        if (ca.state === "free" || ca.state === "reported")
          (ca.state === "free" ? options : reportedOptions).push({
            [a.kind]: a.id,
            end: new Date(t + a.duration * 60000).toISOString(),
          });
        else {
          uncertain ||= ca.state === "unknown";
          reasons.add(ca.reason);
        }
        continue;
      }
      const dryers = eligible.filter((m) => m.kind === "dry");
      if (!dryers.length) {
        uncertain = true;
        reasons.add("Secadoras ainda não validadas");
      }
      for (const b of dryers) {
        const dryStart = t + (a.duration + transfer) * 60000;
        const cb = check(b, dryStart);
        if ((ca.state === "free" || ca.state === "reported") && (cb.state === "free" || cb.state === "reported"))
          (ca.state === "free" && cb.state === "free" ? options : reportedOptions).push({
            wash: a.id,
            dry: b.id,
            end: new Date(dryStart + b.duration * 60000).toISOString(),
          });
        else if (ca.state !== "busy" && cb.state !== "busy") {
          uncertain = true;
          reasons.add(ca.state === "unknown" ? ca.reason : cb.reason);
        } else reasons.add(ca.state === "busy" ? ca.reason : cb.reason);
      }
    }
    return {
      start,
      state: options.length ? "free" : reportedOptions.length ? "reported" : uncertain ? "unknown" : "busy",
      reason: options.length
        ? "Livre no snapshot"
        : reportedOptions.length ? REPORTED_START : [...reasons][0] || "Indisponível",
      options: options.length ? options : reportedOptions,
    };
  });
}
export function groupSlots(slots: Slot[]) {
  const groups: Slot[][] = [];
  for (const s of slots) {
    const last = groups.at(-1);
    if (
      last &&
      last[0].state === s.state &&
      Date.parse(s.start) - Date.parse(last.at(-1)!.start) === 300000
    )
      last.push(s);
    else groups.push([s]);
  }
  return groups;
}
