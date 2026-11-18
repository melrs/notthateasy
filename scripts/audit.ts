import { auditDirectory } from "./publication";
const secrets = ["FOREASY_EMAIL", "FOREASY_PASSWORD", "FOREASY_TOKEN_KEY"].map(
  (key) => process.env[key] || "",
);
auditDirectory("dist", secrets)
  .then(() =>
    console.log("Publicação validada: somente campos anônimos permitidos."),
  )
  .catch(() => {
    console.error("Publicação bloqueada pela validação de privacidade.");
    process.exitCode = 1;
  });
