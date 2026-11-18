import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addDate,
  clock,
  dateSP,
  groupSlots,
  plan,
  type Day,
  type Manifest,
  type Mode,
  type Slot,
} from "../shared/model";
import "./style.css";
const base = import.meta.env.BASE_URL;
const modes: { id: Mode; label: string }[] = [
  { id: "pair", label: "Lavar + secar" },
  { id: "wash", label: "Só lavar" },
  { id: "dry", label: "Só secar" },
];
async function json<T>(name: string, signal: AbortSignal): Promise<T> {
  const r = await fetch(
    `${base}data/${name}${name.includes("?") ? "&" : "?"}reload=${Date.now()}`,
    { cache: "no-store", signal },
  );
  if (!r.ok) throw Error();
  return r.json();
}
function endLabel(start: string, end: string) {
  return `${clock(end)}${dateSP(Date.parse(end)) !== dateSP(Date.parse(start)) ? " · dia seguinte" : ""}`;
}
function Window({ slots, mode }: { slots: Slot[]; mode: Mode }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(12);
  const first = slots[0],
    last = slots.at(-1)!;
  return (
    <article className={`window ${first.state}`}>
      <button
        className="window-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="status-dot" />
        <span className="window-title">
          <strong>
            {clock(first.start)}
            {slots.length > 1 && <> — {clock(last.start)}</>}
          </strong>
          <span>
            {slots.length} {slots.length === 1 ? "início" : "inícios"} · a cada
            5 min
          </span>
        </span>
        <span className="status-label">
          {first.state === "free"
            ? "Livre"
            : first.state === "busy"
              ? "Indisponível"
              : "Não confirmado"}
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="window-body">
          {slots.slice(0, count).map((s) => (
            <details key={s.start} className="slot">
              <summary>
                <b>{clock(s.start)}</b>
                <span>
                  {s.state === "free"
                    ? `${mode === "pair" ? "Lavar e secar" : "Ciclo"} até ${endLabel(s.start, s.options[0].end)}`
                    : s.reason}
                </span>
              </summary>
              {s.options.length > 0 ? (
                <ul>
                  {[...new Set(s.options.map((o) => o.end))].map((end) => (
                    <li key={end}>
                      Conclusão às {endLabel(s.start, end)} · disponibilidade no
                      snapshot
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  {s.reason}.{" "}
                  {s.state === "unknown"
                    ? "Este horário não está confirmado."
                    : "Consulte outro horário."}
                </p>
              )}
            </details>
          ))}
          {slots.length > count && (
            <button
              className="text-button"
              onClick={() => setCount(count + 12)}
            >
              Mostrar mais 12 horários
            </button>
          )}
        </div>
      )}
    </article>
  );
}
function App() {
  const [mode, setMode] = useState<Mode>("pair");
  const [date, setDate] = useState(dateSP());
  const [transfer, setTransfer] = useState(0);
  const [revision, setRevision] = useState(0);
  const [manifest, setManifest] = useState<Manifest>();
  const [days, setDays] = useState<Day[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [onlyFree, setOnlyFree] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDate(dateSP(now), i)),
    [dateSP(now)],
  );
  useEffect(() => {
    if (!dates.includes(date)) setDate(dates[0]);
  }, [dates, date]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setDays([]);
    (async () => {
      try {
        const m = await json<Manifest>("manifest.json", abort.signal);
        if (
          m.version !== 1 ||
          !Array.isArray(m.dates) ||
          !m.files ||
          !Array.isArray(m.machines)
        )
          throw Error();
        setManifest(m);
        if (!m.dates.includes(date)) throw Error();
        const readDates = mode === "pair" ? [date, addDate(date, 1)] : [date];
        const loaded = await Promise.all(
          readDates.map(async (d) => {
            const file = m.files[d];
            if (file !== `day-${d}.json`) throw Error();
            const data = await json<Day>(
              `${file}?version=${encodeURIComponent(m.generatedAt)}`,
              abort.signal,
            );
            if (
              data.date !== d ||
              !Array.isArray(data.observations) ||
              data.observations.some((o) => o.checkedAt !== m.generatedAt)
            )
              throw Error();
            return data;
          }),
        );
        if (!abort.signal.aborted) setDays(loaded);
      } catch {
        if (!abort.signal.aborted)
          setError(
            "Não foi possível carregar este dia. Tente atualizar os dados publicados.",
          );
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [date, mode, revision]);
  const slots = useMemo(
    () =>
      plan(
        date,
        mode,
        manifest?.machines || [],
        days.flatMap((d) => d.observations),
        transfer,
        now,
      ),
    [date, mode, manifest, days, transfer, now],
  );
  const upcoming = slots.filter((s) => Date.parse(s.start) >= now);
  const groups = groupSlots(upcoming);
  const visible = onlyFree
    ? groups.filter((g) => g[0].state === "free")
    : groups;
  const age = manifest
    ? Math.max(0, Math.floor((now - Date.parse(manifest.generatedAt)) / 60000))
    : 0;
  return (
    <main className="agenda-app">
      <header className="topbar">
        <div>
          <h1>Agenda</h1>
          <p>Horários de início · Brasília</p>
        </div>
        <button
          className="refresh"
          disabled={loading}
          onClick={() => setRevision((v) => v + 1)}
          aria-label="Atualizar último snapshot publicado"
        >
          {loading ? "Carregando…" : "↻ Atualizar"}
        </button>
      </header>
      {manifest?.demo && (
        <p className="notice" role="status">
          Demonstração · horários fictícios
        </p>
      )}
      <nav className="days" aria-label="Escolha o dia">
        {dates.map((d, i) => (
          <button
            key={d}
            onClick={() => setDate(d)}
            aria-pressed={d === date}
            className={d === date ? "selected" : ""}
          >
            <span>
              {i === 0
                ? "Hoje"
                : i === 1
                  ? "Amanhã"
                  : new Intl.DateTimeFormat("pt-BR", {
                      weekday: "short",
                      timeZone: "America/Sao_Paulo",
                    })
                      .format(new Date(`${d}T12:00:00-03:00`))
                      .replace(".", "")}
            </span>
            <strong>{d.slice(8)}</strong>
          </button>
        ))}
      </nav>
      <div className="segmented" aria-label="Tipo de ciclo">
        {modes.map((m) => (
          <button
            key={m.id}
            aria-pressed={mode === m.id}
            className={mode === m.id ? "active" : ""}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="settings">
        {mode === "pair" ? (
          <details className="transfer">
            <summary>Transferência: {transfer} min</summary>
            <label>
              Entre lavar e secar{" "}
              <select
                aria-label="Tempo para transferir"
                value={transfer}
                onChange={(e) => setTransfer(Number(e.target.value))}
              >
                {[0, 5, 10, 15, 20, 30].map((n) => (
                  <option key={n} value={n}>
                    {n} min
                  </option>
                ))}
              </select>
            </label>
          </details>
        ) : (
          <span />
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={onlyFree}
            onChange={(e) => setOnlyFree(e.target.checked)}
          />{" "}
          Só livres
        </label>
      </div>
      <section aria-label="Disponibilidade do dia" aria-live="polite">
        {loading ? (
          <div className="empty">Carregando agenda…</div>
        ) : error ? (
          <div className="empty error" role="alert">
            {error}
          </div>
        ) : (
          <>
            {visible.length ? (
              visible.map((g) => (
                <Window
                  key={`${date}-${mode}-${transfer}-${revision}-${g[0].start}-${g[0].state}`}
                  slots={g}
                  mode={mode}
                />
              ))
            ) : (
              <div className="empty">
                {onlyFree
                  ? "Nenhum início livre confirmado. Desative o filtro para ver os demais."
                  : "Não há mais inícios neste dia."}
              </div>
            )}
          </>
        )}
      </section>
      <footer>
        <p>
          {manifest
            ? `Publicado ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(manifest.generatedAt))} · há ${age} min`
            : "Aguardando a primeira publicação."}
        </p>
        <p>
          Atualizar recarrega a publicação. Após 75 min, os dados ficam não
          confirmados. Confirme no app oficial antes de reservar.
        </p>
        {manifest?.warnings
          .filter((w) => w !== "Demonstração fictícia.")
          .map((w) => (
            <p className="warning" key={w}>
              {w}
            </p>
          ))}
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if ("serviceWorker" in navigator)
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${base}sw.js`).catch(() => {});
  });
