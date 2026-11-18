# Agenda anônima de lavanderia

MVP mobile-first em React + TypeScript + Vite, instalável como PWA. Somente GitHub Pages e GitHub Actions; sem Worker, servidor dedicado, login na interface ou reservas.

O navegador acessa apenas arquivos estáticos anônimos do próprio site. O Actions autentica na Foreasy, coleta os dados e publica um novo snapshot. **Não é uma agenda em tempo real:** atualizar na interface recarrega a publicação mais recente. Não dispara workflows nem consulta a Foreasy.

## Testar localmente, sem credenciais

Requer Node.js 22 e npm. Na pasta do projeto:

```sh
npm ci --ignore-scripts
npm test
npm run demo
npm run dev
```

A demonstração é fictícia, identificada na interface e não faz chamadas externas. Refaça `npm run demo` se o snapshot envelhecer. Não há `.env` real incluído. O gerador não lê `.env` automaticamente.

Para verificar os arquivos de produção:

```sh
npm run build
npm run audit
npx vite preview --host 127.0.0.1
```

O último comando serve o build localmente. Para simular Pages em subpasta, defina `VITE_BASE_PATH=/agenda/` antes do build e abra esse caminho. A auditoria verifica o conteúdo de `dist/`, incluindo campos permitidos nos JSONs, nomes de arquivos, ausência de JWTs e presença acidental de Secrets conhecidos. A aplicação não inclui analytics, fontes externas, mapas, links de localização ou respostas brutas.

## Instalação no GitHub

Nenhum repositório foi criado, nenhum Secret foi configurado e nada foi publicado nesta entrega. Instalar e habilitar os workflows abaixo autoriza as execuções futuras na sua conta.

1. Crie um repositório **privado**, com nome neutro, e envie o conteúdo desta pasta, incluindo arquivos ocultos e `package-lock.json`. Não envie `node_modules`, `dist`, `.private`, `.env` ou `public/data`. Os dados de demonstração são ignorados pelo Git e nunca usados pelo workflow de produção.
2. Em **Settings → Secrets and variables → Actions → Secrets**, cadastre:

   | Secret | Conteúdo |
   | --- | --- |
   | `FOREASY_EMAIL` | E-mail de uma credencial nova da Foreasy |
   | `FOREASY_PASSWORD` | Senha nova, nunca a exposta em conversas |
   | `FOREASY_TOKEN_KEY` | Chave aleatória de 32 bytes, em base64 |
   | `FOREASY_BUILDING_ID` | Identificador numérico esperado do prédio; o login deve pertencer a ele |
   | `FOREASY_MACHINE_CONFIG` | Array privado de IDs, tipos, ciclos e permissão de agendamento já conferidos |

   Gere a chave uma vez em ambiente privado: `openssl rand -base64 32`. Guarde-a apenas como Secret; não coloque chave ou JWT em Variables, comandos de workflow, commits ou mensagens. Não precisa inserir um JWT manualmente. Exemplo **fictício** do formato de configuração:

   ```json
   [{"id":10001,"kind":"wash","duration":60,"enabled":true},
    {"id":10002,"kind":"dry","duration":60,"enabled":true}]
   ```

   Confirme a permissão real de agendamento de cada máquina. `enabled:false` a exclui. Um `allow_scheduling:false` ou `0` explícito na API sempre a exclui, mesmo com configuração habilitada. Outros nomes de campos exigem ajuste do adaptador após validação. Não configure IDs, nomes ou endereços reais em arquivos rastreados.
3. Em **Settings → Pages → Build and deployment**, escolha **GitHub Actions**. Confira a disponibilidade de Pages para seu plano/repositório privado na [documentação oficial](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages). Um repositório privado não torna o site Pages privado por padrão. Use proprietário e URL neutros: o próprio endereço do Pages pode identificar a conta GitHub, independentemente do conteúdo desta aplicação.
4. Em **Actions → Variables**, crie `ENABLE_AUTOMATION=true`. O workflow fica inativo sem esta opção. Defina `FOREASY_CONTRACT=unverified` inicialmente. Os demais valores são opcionais:

   | Variable | Padrão | Efeito |
   | --- | --- | --- |
   | `FOREASY_CONTRACT` | `unverified` | Contrato validado, descrito abaixo |
   | `FOREASY_MAX_CALLS` | `40` | Teto por execução, incluindo login e retry; máximo absoluto 60 |
   | `FOREASY_PROBE_DATE_OFFSET` | `0` | Dia amostrado, hoje = 0 até hoje + 6 |
   | `FOREASY_PROBE_TIME` | `09:00` | Primeiro dos seis inícios de uma janela de 30 min; múltiplo de 5 min |

5. Execute **Actions → Atualizar agenda anônima → Run workflow**. A agenda será publicada após testes, geração, build e auditoria. Os próximos ciclos ocorrem no minuto 17 de cada hora, em UTC. O gatilho de push pressupõe branch `main`; ajuste se usar outro nome. Execuções e deploys são serializados. Desative a automação removendo `ENABLE_AUTOMATION=true`.
6. No celular, abra a URL HTTPS do Pages e use “Adicionar à tela inicial” ou “Instalar aplicativo”, quando oferecido pelo navegador.

O Actions calcula o caminho base do site pelo `configure-pages`, inclusive para subpastas. Não é necessário editar o código para colocar a URL do repositório. A publicação envia **somente `dist/`**, nunca a pasta do projeto.

## Validação real e contratos da API

**Não foi feita autenticação real nem consulta com credenciais da conversa. Rate limits e schemas de manutenção/bloqueios continuam desconhecidos.** Os contratos abaixo são formatos suportados pelo adaptador, não schemas atribuídos à Foreasy como fato. A instalação não deve declarar um contrato validado antes de conferir suas respostas e semântica com credenciais novas em ambiente privado.

Com `unverified`, há autenticação automática e uma consulta a `/machines/building/{id}`. Nenhuma varredura de horários é feita. A interface mostra horários não confirmados até que o contrato seja validado. Catalogação inválida interrompe a geração, preservando a publicação anterior, que envelhece visivelmente.

### `day-v1`: preferido após confirmação

Só habilite se os dois endpoints abaixo retornarem **todos** os intervalos que sobrepõem o dia consultado, incluindo intervalos iniciados em outro dia, sem paginação omitida ou filtragem por instante:

- `GET /schedules/slots-bloqueados/{id}?date=YYYY-MM-DD`
- `GET /manutencao-programada/ativas/building/{id}?date=YYYY-MM-DD&time=00:00`

Cada resposta deve ser um array com o contrato canônico:

```json
[{"machine_id":10001,"start":"2030-01-01T10:00:00-03:00","end":"2030-01-01T11:00:00-03:00"}]
```

`[]` precisa significar ausência completa de intervalos para o dia, **não** apenas ausência à meia-noite. Se a manutenção for filtrada pelo instante `time`, este modo é inadequado até existir um adaptador ou fonte que forneça cobertura diária completa. Falta de timezone, fim anterior ao início, objeto inesperado ou erro de consulta tornam o período desconhecido. Campos adicionais da resposta são descartados. Se houver indisponibilidade permanente, ela deve constar da configuração de agendamento ou da manutenção; estado de ocupação atual da máquina não serve como bloqueio diário.

Custo: **1 catálogo + 8 dias × 2 calendários = 17 GETs por execução**. O oitavo dia é apenas apoio para ciclos que atravessam a meia-noite do sétimo; não aparece no seletor. A interface oferece hoje + 6 dias. Não há chamadas por slot neste modo. Todos os inícios de 5 min são calculados localmente com intervalos semiabertos `[início, fim)`.

### `cycle-v1`: amostragem conservadora

Use apenas se tiver sido confirmado que:

- `/schedules/maquinas-disponiveis/{id}?date=...&hora=HH:mm` devolve um array `{machine_id:number, available:boolean, reason?:unknown}` e valida **o ciclo completo** daquela máquina a partir do início consultado, não somente a ocupação naquele instante.
- O endpoint de manutenção, com `time=HH:mm`, devolve os intervalos canônicos acima que podem afetar **o ciclo completo**, inclusive após meia-noite. `[]` precisa confirmar essa ausência.
- O endpoint de bloqueios retorna os intervalos diários completos no contrato canônico.

Consulta somente seis inícios consecutivos no dia/hora configurados, mais os inícios de seca após as durações de lavagem. Para um único ciclo de 60 min, normalmente são 12 instantes × 2 endpoints + catálogo + bloqueios, além do login quando necessário. Outras durações ou virada de dia podem consumir o teto; o restante fica não confirmado. A transferência padrão 0 é coberta; transferências diferentes podem resultar em horários não consultados. Não há promessa de cobertura completa da semana neste modo. Não há coleta acionada por cliques no navegador.

Um `available:false` é indisponibilidade; o texto livre `reason` nunca é publicado, pois pode carregar dados pessoais. `available:true` só confirma o início com as demais evidências necessárias. Não inferimos que “ocupada agora” significa “ocupada mais tarde”.

Se os schemas reais forem diferentes, atualize `scripts/adapters.ts` e os testes antes de habilitar o contrato. É preferível manter horários desconhecidos a converter um dado ambíguo em disponibilidade.

## Token e limites de execução

- Login: `POST https://api.foreasy.com.br/login`, corpo `{email,password}`. Só são retidos JWT, instante de emissão, validade e hash de vinculação à conta/prédio. A resposta `user` é descartada após conferir `building_id`. Não é serializada nem registrada.
- O JWT é reutilizado até **15 dias desde o login**, respeitando também `exp` com margem de 5 min; na ausência de `exp` legível, usa a validade declarada de 30 dias. A primeira execução após completar 15 dias renova automaticamente. Não se usa cron “a cada 15 dias do mês”, que não representa 15 dias corridos.
- Um GET com 401 força um login e **uma única repetição** do GET. Um segundo 401 interrompe novas chamadas na execução. Não há retry ilimitado nem reserva; só `/login` aceita POST.
- O estado é cifrado com **AES-256-GCM**, IV aleatório e AAD versionada, antes de gravar `.private/token.bin`. Somente esse ciphertext vai ao cache do Actions. A chave nunca vai ao cache. O cache é tratado como armazenamento não confiável e recuperável, não como um cofre de Secrets. Adulteração, chave nova, conta diferente, expiração ou cache ausente causam novo login automático. Nenhum PAT com permissão de escrita de Secrets é necessário.
- O cache do Actions é imutável e pode ser removido; por isso cada execução salva uma nova chave, restaura a mais recente por prefixo e sabe refazer login. [Política oficial de cache e segurança](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching). Não coloque outros arquivos em `.private` nem altere o path do cache para incluir arquivos de ambiente.
- Há uma única execução de produção por vez, requisições **sequenciais**, intervalo mínimo de **1,2 s**, deduplicação por URL dentro da execução, timeout de rede de 12 s e teto padrão 40 chamadas incluindo login/retry. Um 429 suspende novas consultas naquela execução. Não se repete 5xx automaticamente. Falhas parciais viram desconhecidas; falha de catálogo/login impede deploy. A frequência inicial é horária, não a cada 5 min.
- São 24 execuções agendadas/dia; no modo diário, aproximadamente 408 GETs/dia. **Isso não prova que o volume seja aceito pela Foreasy.** Reduza o cron/teto se necessário após validar limites e autorização de uso. Fica dentro de 6 min por job de build e 5 min por deploy; o custo mensal depende do plano, duração e outros workflows.
- [Schedules podem atrasar ou ser descartados](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) e, em repositórios públicos inativos, podem ser desabilitados. Não há garantia de renovação no segundo exato nem de atualização horária. Ao retomar, o token é renovado automaticamente se necessário.

## Privacidade e limites do site estático

O site não publica nome do condomínio, endereço, apartamento, nome de pessoa, e-mail, telefone, CPF, identificador do prédio, IDs reais de máquinas, ocupante de reserva, saldo, credenciais, JWT ou textos livres da Foreasy. A identificação do prédio e o mapa real de máquinas são Secrets. O catálogo público agrega máquinas por **tipo e duração**, atribuindo IDs sintéticos de categorias; não divulga nomes, quantidade ou IDs reais de máquinas. O frontend não contém URLs da Foreasy nem código de autenticação.

A fronteira de publicação usa projeção explícita e lista fechada de campos. Há validação recursiva do contrato público, mensagens de falha genéricas, nenhum log de request/response, nenhum token em stdout e auditoria final antes do upload. Os únicos dados de aplicação publicados são datas, horários, duração, estado agregado, timestamps de coleta e mensagens fixas. Workflows usam Actions fixadas por SHA, permissões mínimas, Secrets apenas nas etapas que os exigem, checkout sem credencial persistida e nenhum Secret em testes de pull request. Revisões de dependências e workflows continuam necessárias; mantenedores com acesso a código de produção podem alterar código para ler Secrets. Não execute código não revisado com Secrets.

**Quem possui o link consegue ver os horários anônimos.** Sem autenticação ou controle de acesso do próprio Pages, não é possível impedir acesso aos JSONs, cópia ou inferências por correlação com informação externa. A aplicação evita publicar identificadores, mas não promete anonimato absoluto contra correlação, nem oculta do GitHub os metadados de acesso. URL, conta GitHub, nomes de repositório, descrição, screenshots e README do repositório também devem ser neutros. Não inclua dados identificadores nesses locais. O site não usa CORS como proteção. Se a disponibilidade em si precisar ser confidencial, a restrição “Pages público sem login” precisa ser revista.

A PWA guarda apenas recursos da interface. JSONs não vão ao cache do service worker; não há dados de disponibilidade offline. Dados com mais de 75 min tornam-se desconhecidos. O botão Atualizar não reduz a idade de um snapshot nem dá garantia para reservar; confirme sempre no aplicativo oficial. A aplicação não possui endpoint ou botão de reserva.

## Regras da agenda

- Padrão lavar + secar em sequência; filtros só lavar/só secar.
- Ciclos padrão de 60 min, configuração individual permitida em múltiplos de 5 min.
- Antecedência mínima por etapa: 60 min; ciclos maiores que 60 min exigem duração + 10 min.
- Transferência configurável na interface, padrão 0 min.
- Fuso `America/Sao_Paulo`. A API exige data/hora local; a representação interna é um instante ISO UTC. O offset usado na conversão de entrada é `-03:00`, adequado ao período atual; se a legislação de horário de verão mudar, ajuste essa conversão antes do uso.
- Sequências podem terminar no dia seguinte, inclusive para o último dia do seletor. O snapshot inclui um dia de apoio e a interface carrega somente o dia selecionado + esse próximo dia quando necessário.
- Janelas agrupam **inícios consecutivos**, não blocos inteiros de ocupação. Expandir revela cada início e as conclusões possíveis. Indisponível e desconhecido são estados distintos.

## Arquivos principais

- `shared/model.ts`: fuso, slots, antecedência, pares, transferência e agrupamento.
- `scripts/client.ts`: transporte restrito, JWT, limites, cache cifrado e retry 401.
- `scripts/adapters.ts` e `scripts/collector.ts`: contratos conservadores e coleta limitada.
- `scripts/privacy.ts` e `scripts/audit.ts`: projeção anônima e bloqueio de publicação indevida.
- `scripts/generate.ts`: saída atômica de JSONs e persistência cifrada do token.
- `src/`: interface React; `public/sw.js`: PWA sem cache de disponibilidade.
- `.github/workflows/`: atualização/publicação e testes sem Secrets.

Os testes cobrem tempo, sequência, transferência, manutenção, fronteiras de intervalo, schemas desconhecidos, orçamento, renovação por idade/401, adulteração do cache e regressões de privacidade. Os fixtures são sintéticos. A validação do endpoint real e a publicação no GitHub não foram executadas.
