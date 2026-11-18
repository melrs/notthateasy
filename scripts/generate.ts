import { mkdir, readFile, writeFile, rm, rename } from "node:fs/promises";
import { Client, seal, unseal } from "./client";
import { collect, fixture } from "./collector";
import { anonymize, validatePublic } from "./privacy";
import type { Manifest } from "../shared/model";
async function main() {
  const demo = process.argv.includes("--fixture");
  const now = Date.now();
  let client: Client | undefined;
  let result;
  if (demo) result = fixture(now);
  else {
    const {
      FOREASY_EMAIL: email,
      FOREASY_PASSWORD: password,
      FOREASY_TOKEN_KEY: key,
      FOREASY_BUILDING_ID: buildingRaw,
    } = process.env;
    const building = Number(buildingRaw),
      maxCalls = Number(process.env.FOREASY_MAX_CALLS || 40);
    if (
      !email ||
      !password ||
      !key ||
      Buffer.from(key, "base64").length !== 32 ||
      !Number.isInteger(building) ||
      building < 1 ||
      !Number.isInteger(maxCalls) ||
      maxCalls < 1 ||
      maxCalls > 60
    )
      throw new Error("configuration");
    let state;
    try {
      state = unseal(await readFile(".private/token.bin"), key);
    } catch {
      /* Cache ausente: login automático. */
    }
    client = new Client({ email, password, building, maxCalls, state });
    try {
      await client.authenticate();
      result = await collect(
        client,
        building,
        JSON.parse(process.env.FOREASY_MACHINE_CONFIG || "null"),
        process.env.FOREASY_CONTRACT || "unverified",
        Number(process.env.FOREASY_PROBE_DATE_OFFSET || 0),
        process.env.FOREASY_PROBE_TIME || "",
        now,
      );
    } finally {
      if (client.state) {
        await mkdir(".private", { recursive: true });
        await writeFile(".private/token.bin", seal(client.state, key), {
          mode: 0o600,
        });
      }
    }
  }
  const publicData = anonymize(result.machines, result.days);
  const manifest: Manifest = {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    demo,
    machines: publicData.machines,
    dates: publicData.days.slice(0, 7).map((d) => d.date),
    files: Object.fromEntries(
      publicData.days.map((d) => [d.date, `day-${d.date}.json`]),
    ),
    calls: client?.calls || 0,
    warnings: demo
      ? ["Demonstração fictícia."]
      : process.env.FOREASY_CONTRACT === "unverified" ||
          !process.env.FOREASY_CONTRACT
        ? ["Dados não confirmados: contrato da API pendente."]
        : result.partial
          ? ["Consulta parcial: confira os horários não confirmados."]
          : [],
  };
  validatePublic(manifest, publicData.days);
  await rm("public/data.tmp", { recursive: true, force: true });
  await mkdir("public/data.tmp", { recursive: true });
  for (const day of publicData.days)
    await writeFile(
      `public/data.tmp/${manifest.files[day.date]}`,
      JSON.stringify(day),
    );
  await writeFile("public/data.tmp/manifest.json", JSON.stringify(manifest));
  await rm("public/data", { recursive: true, force: true });
  await rename("public/data.tmp", "public/data");
  console.log(
    `Snapshot anônimo gerado; chamadas: ${manifest.calls}; demonstração: ${demo}.`,
  );
}
main().catch(() => {
  console.error(
    "Geração interrompida com segurança. Verifique Secrets, configuração e contrato da API. Nenhuma resposta bruta foi registrada.",
  );
  process.exitCode = 1;
});
