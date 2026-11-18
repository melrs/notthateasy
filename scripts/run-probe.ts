import { probe } from './probe';
const { FOREASY_EMAIL, FOREASY_PASSWORD, FOREASY_BUILDING_ID } = process.env;
probe({ email: FOREASY_EMAIL || '', password: FOREASY_PASSWORD || '', expectedBuilding: FOREASY_BUILDING_ID })
  .then(ok => { if (!ok) process.exitCode = 1; })
  .catch(() => { console.error('Diagnóstico interrompido.'); process.exitCode = 1; });
