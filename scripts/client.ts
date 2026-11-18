import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
export type TokenState = {
  token: string;
  issuedAt: number;
  expiresAt: number;
  scope: string;
};
export function seal(state: TokenState, key: string) {
  const k = Buffer.from(key, "base64");
  if (k.length !== 32) throw new Error("token-key");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k, iv);
  c.setAAD(Buffer.from("agenda-token-v1"));
  const body = Buffer.concat([c.update(JSON.stringify(state)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}
export function unseal(blob: Buffer, key: string): TokenState | undefined {
  try {
    const d = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "base64"),
      blob.subarray(0, 12),
    );
    d.setAAD(Buffer.from("agenda-token-v1"));
    d.setAuthTag(blob.subarray(12, 28));
    const s = JSON.parse(
      Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString(),
    );
    if (
      typeof s.scope !== "string" ||
      typeof s.token !== "string" ||
      !Number.isFinite(s.issuedAt) ||
      !Number.isFinite(s.expiresAt)
    )
      return;
    return {
      token: s.token,
      issuedAt: s.issuedAt,
      expiresAt: s.expiresAt,
      scope: s.scope,
    };
  } catch {
    return;
  }
}
export class SafeError extends Error {}
type Settings = {
  email: string;
  password: string;
  building: number;
  maxCalls: number;
  state?: TokenState;
  fetcher?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};
export class Client {
  state?: TokenState;
  calls = 0;
  stopped = false;
  private last = 0;
  private pending = new Map<string, Promise<unknown>>();
  private fetcher: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;
  constructor(private s: Settings) {
    this.state = s.state;
    this.fetcher = s.fetcher ?? fetch;
    this.sleep = s.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = s.now ?? Date.now;
  }
  private async request(path: string, login = false): Promise<Response> {
    if (this.stopped || this.calls >= Math.min(60, this.s.maxCalls))
      throw new SafeError("limite-de-consultas");
    await this.sleep(Math.max(0, 1200 - (this.now() - this.last)));
    this.last = this.now();
    this.calls++;
    try {
      const r = await this.fetcher(`https://api.foreasy.com.br${path}`, {
        method: login ? "POST" : "GET",
        headers: login
          ? { "Content-Type": "application/json" }
          : { Authorization: `Bearer ${this.state!.token}` },
        body: login
          ? JSON.stringify({ email: this.s.email, password: this.s.password })
          : undefined,
        signal: AbortSignal.timeout(12000),
        redirect: "error",
      });
      if (r.status === 429) {
        this.stopped = true;
        throw new SafeError("limite-da-api");
      }
      return r;
    } catch (e) {
      if (e instanceof SafeError) throw e;
      throw new SafeError("falha-de-rede");
    }
  }
  async login() {
    const r = await this.request("/login", true);
    if (!r.ok) {
      this.stopped = true;
      throw new SafeError("autenticacao-indisponivel");
    }
    let value: any;
    try {
      value = await r.json();
    } catch {
      throw new SafeError("login-invalido");
    }
    if (
      value?.user?.building_id !== this.s.building ||
      typeof value.token !== "string" ||
      value.token.length < 20
    )
      throw new SafeError("login-invalido");
    let exp = this.now() + 30 * 86400000;
    try {
      const claim = JSON.parse(
        Buffer.from(value.token.split(".")[1], "base64url").toString(),
      );
      if (Number.isFinite(claim.exp)) exp = Math.min(exp, claim.exp * 1000);
    } catch {
      /* validade declarada: 30 dias */
    }
    if (exp <= this.now() + 300000) throw new SafeError("token-expirado");
    this.state = {
      token: value.token,
      issuedAt: this.now(),
      expiresAt: exp,
      scope: this.scope(),
    };
  }
  private scope() {
    return createHash("sha256")
      .update(`${this.s.email}:${this.s.building}`)
      .digest("hex");
  }
  async authenticate() {
    if (
      !this.state ||
      this.state.scope !== this.scope() ||
      this.now() - this.state.issuedAt >= 15 * 86400000 ||
      this.state.expiresAt - this.now() < 300000 ||
      this.state.issuedAt > this.now()
    )
      await this.login();
  }
  get(path: string): Promise<unknown> {
    const allowed = new RegExp(
      `^/(machines/building/${this.s.building}|schedules/(maquinas-disponiveis|slots-bloqueados)/${this.s.building}\\?date=\\d{4}-\\d{2}-\\d{2}(&hora=\\d{2}:\\d{2})?|manutencao-programada/ativas/building/${this.s.building}\\?date=\\d{4}-\\d{2}-\\d{2}&time=\\d{2}:\\d{2})$`,
    );
    if (!allowed.test(path)) throw new SafeError("endpoint-nao-permitido");
    if (this.pending.has(path)) return this.pending.get(path)!;
    const p = (async () => {
      await this.authenticate();
      let r = await this.request(path);
      if (r.status === 401) {
        await this.login();
        r = await this.request(path);
      }
      if (!r.ok) {
        if (r.status === 401) this.stopped = true;
        throw new SafeError(
          r.status === 401
            ? "autenticacao-indisponivel"
            : "resposta-indisponivel",
        );
      }
      try {
        return await r.json();
      } catch {
        throw new SafeError("resposta-invalida");
      }
    })();
    this.pending.set(path, p);
    return p;
  }
}
