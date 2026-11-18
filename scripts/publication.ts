import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { validatePublic } from "./privacy";
import type { Day, Manifest } from "../shared/model";
export async function auditDirectory(root: string, secrets: string[] = []) {
  const manifest: Manifest = JSON.parse(
    await readFile(join(root, "data/manifest.json"), "utf8"),
  );
  // Valide nomes e tipos antes de abrir qualquer arquivo indicado pelo manifesto.
  validatePublic(manifest, []);
  const names = await readdir(join(root, "data"));
  const expected = ["manifest.json", ...Object.values(manifest.files)];
  if (
    names.length !== expected.length ||
    names.some((n) => !expected.includes(n))
  )
    throw new Error("publication-files");
  const days: Day[] = await Promise.all(
    Object.values(manifest.files).map((f) =>
      readFile(join(root, "data", f), "utf8").then(JSON.parse),
    ),
  );
  validatePublic(manifest, days);
  const files = await readdir(root, { recursive: true });
  for (const f of files) {
    const path = join(root, f),
      stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error("publication-link");
    if (stat.isDirectory()) {
      if (!["assets", "data"].includes(f))
        throw new Error("publication-folder");
      continue;
    }
    if (
      !/^(index\.html|icon\.svg|manifest\.webmanifest|sw\.js|assets\/index-[A-Za-z0-9_-]+\.(js|css)|data\/(manifest|day-\d{4}-\d{2}-\d{2})\.json)$/.test(
        f,
      )
    )
      throw new Error("publication-files");
    const text = await readFile(path, "utf8");
    if (
      secrets.some((value) => value.length >= 4 && text.includes(value)) ||
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text)
    )
      throw new Error("publication-secret");
  }
}
