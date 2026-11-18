import {expect,it,vi} from 'vitest';
import {probe,describeSchema} from '../scripts/probe';
it('descreve somente campos permitidos e seus tipos, sem valores, nomes dinâmicos ou contagens',()=>{
  expect(describeSchema({data:[{id:55501, name:'PRIVATE_SENTINEL', reason:'PRIVATE_SENTINEL', PRIVATE_SENTINEL:123}]})).toBe('object · listas permitidas: data · id:number, reason:string');
});
it('não registra tokens, credenciais, IDs ou mensagens de erro externas',async()=>{
  const log=vi.fn();const fetcher=vi.fn().mockResolvedValueOnce(Response.json({user:{building_id:55501},token:'PRIVATE_SENTINEL_TOKEN'})).mockResolvedValueOnce(Response.json([{machine_id:999999,reason:'PRIVATE_SENTINEL'}])).mockRejectedValue(new Error('PRIVATE_SENTINEL'));
  expect(await probe({email:'fake@example.invalid',password:'PRIVATE_SENTINEL',delay:async()=>{},fetcher,log})).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_SENTINEL|55501|999999|fake@example/);
});
it('interrompe a consulta em 429',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({user:{building_id:123},token:'fixture-token-over-twenty-characters'})).mockResolvedValueOnce(new Response(null,{status:429}));
  await expect(probe({email:'test@example.invalid',password:'fixture',delay:async()=>{},fetcher,log:()=>{}})).resolves.toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
