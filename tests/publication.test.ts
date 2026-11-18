import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditDirectory } from "../scripts/publication";
import { fixture } from "../scripts/collector";
import { anonymize } from "../scripts/privacy";
import type { Manifest } from "../shared/model";
async function directory(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "agenda-audit-"));
  try {
    const now = Date.parse("2030-01-01T12:00:00Z");
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
    await mkdir(join(root, "data"));
    await writeFile(join(root, "data/manifest.json"), JSON.stringify(m));
    for (const day of a.days)
      await writeFile(
        join(root, "data", m.files[day.date]),
        JSON.stringify(day),
      );
    await writeFile(join(root, "index.html"), '<html lang="pt-BR"></html>');
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
describe("barreira final de publicação", () => {
  it("aprova um artefato anônimo completo", async () =>
    directory(async (root) => {
      await expect(auditDirectory(root)).resolves.toBeUndefined();
    }));
  it("bloqueia arquivos e pastas inesperados, inclusive binários", async () =>
    directory(async (root) => {
      await writeFile(join(root, "secret.bin"), "private-value");
      await expect(auditDirectory(root)).rejects.toThrow("publication-files");
    }));
  it("bloqueia Secret copiado em um arquivo público permitido", async () =>
    directory(async (root) => {
      await writeFile(
        join(root, "index.html"),
        "<html>PRIVATE_SENTINEL</html>",
      );
      await expect(auditDirectory(root, ["PRIVATE_SENTINEL"])).rejects.toThrow(
        "publication-secret",
      );
    }));
  it("bloqueia JWT mesmo sem conhecer o valor do Secret", async () =>
    directory(async (root) => {
      await writeFile(
        join(root, "index.html"),
        "eyJsyntheticHeader.syntheticPayload.syntheticSignature",
      );
      await expect(auditDirectory(root)).rejects.toThrow("publication-secret");
    }));
});
