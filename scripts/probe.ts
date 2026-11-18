import { dateSP, addDate } from '../shared/model';

// Logs can be public. Never emit upstream values, raw keys, lengths, URLs, or exception text.
const fields = [
  'id', 'machine_id', 'maquina_id', 'machineId', 'tipo', 'type', 'kind',
  'status', 'available', 'reason', 'ativo', 'active', 'enabled',
  'allow_scheduling', 'permite_agendamento', 'aceita_agendamento', 'agendavel',
  'duration', 'duracao', 'cycle_duration', 'tempo_ciclo', 'start', 'end',
  'start_time', 'end_time', 'start_date', 'end_date', 'data', 'date', 'hora',
  'hora_inicio', 'hora_fim', 'data_inicio', 'data_fim', 'inicio', 'fim',
  'time', 'machine_ids', 'slots', 'horarios', 'bloqueios', 'maintenance',
  'manutencoes', 'machines', 'maquinas', 'schedules', 'rows', 'items',
] as const;
const fieldType = (value: unknown) => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
function record(value: unknown): Record<string, unknown> | undefined {
  return fieldType(value) === 'object' ? value as Record<string, unknown> : undefined;
}
export function describeSchema(value: unknown): string {
  const root = record(value);
  const containers = root ? ['data', 'machines', 'maquinas', 'slots', 'bloqueios', 'manutencoes', 'maintenance', 'rows', 'items'].filter(key => Array.isArray(root[key])) : [];
  const rows: unknown[] = Array.isArray(value) ? value : containers.flatMap(key => (root![key] as unknown[]).slice(0, 20));
  const samples = rows.length ? rows.slice(0, 20).map(record).filter((row): row is Record<string, unknown> => row !== undefined) : root ? [root] : [];
  const shape = fields.flatMap(key => {
    const types = [...new Set(samples.filter(x => Object.hasOwn(x, key)).map(x => fieldType(x[key])))].sort();
    return types.length ? [`${key}:${types.join('|')}`] : [];
  });
  return [fieldType(value), ...(containers.length ? [`listas permitidas: ${containers.join(', ')}`] : []), ...(shape.length ? [shape.join(', ')] : ['sem evidência de campos conhecidos'])].join(' · ');
}

type ProbeOptions = { email: string; password: string; expectedBuilding?: string; fetcher?: typeof fetch; delay?: () => Promise<void>; log?: (line: string) => void; };
export async function probe({ email, password, expectedBuilding, fetcher = fetch, delay = () => new Promise(r => setTimeout(r,1200)), log = console.log }: ProbeOptions): Promise<boolean> {
  if (!email || !password) {log('Autenticação: faltam Secrets.');return false;}
  const origin = 'https://api.foreasy.com.br';
  const fetchSafe = async (path: string, init: RequestInit) => fetcher(origin + path, { ...init, redirect: 'error', signal: AbortSignal.timeout(12000) });
  let token: string;
  let building: number;
  try {
    const r = await fetchSafe('/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
    if (!r.ok) { log(r.status === 429 ? 'Autenticação: limite da API.' : r.status === 401 || r.status === 403 ? 'Autenticação: credenciais recusadas.' : 'Autenticação: resposta indisponível.');return false; }
    const response = record(await r.json());
    const b = record(response?.user)?.building_id;
    if (typeof b !== 'number' || !Number.isSafeInteger(b) || b < 1 || (expectedBuilding && b !== Number(expectedBuilding)) || typeof response?.token !== 'string' || response.token.length < 20) {
      log('Autenticação: contrato ou vínculo da conta não confirmado.');return false;
    }
    building = b;token = response.token;
    log('Autenticação: aceita.');
  } catch { log('Autenticação: rede ou formato indisponível.');return false; }
  const date = addDate(dateSP(),1);
  const requests: [string,string][] = [
    ['Catálogo',`/machines/building/${building}`],
    ['Bloqueios',`/schedules/slots-bloqueados/${building}?date=${date}`],
    ['Disponibilidade',`/schedules/maquinas-disponiveis/${building}?date=${date}&hora=09:00`],
    ['Manutenção',`/manutencao-programada/ativas/building/${building}?date=${date}&time=09:00`],
  ];
  let all = true;
  for (const [label,path] of requests) {
    await delay();
    try {
      const r = await fetchSafe(path,{method:'GET',headers:{Authorization:`Bearer ${token}`}});
      if (r.status === 429 || r.status === 401 || r.status === 403) {log(`${label}: acesso interrompido pela API.`);return false;}
      if (!r.ok) {log(`${label}: endpoint indisponível.`);all=false;continue;}
      log(`${label}: ${describeSchema(await r.json())}`);
    } catch { log(`${label}: rede ou formato indisponível.`);all=false; }
  }
  return all;
}
