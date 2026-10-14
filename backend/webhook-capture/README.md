# Captura durável de webhooks SingulFit

Componente independente, sem Nest, Prisma, banco SingulFit ou dependências npm.
Nenhuma rota, assinatura, quota, contrato, handler ou flag do backend foi alterada.
Este diretório não é copiado para a imagem atual da API; possui imagem própria.

## Contrato e limites

- Requer Node 22 com `node:sqlite` disponível; validado localmente em 22.18.0.
  O módulo é experimental nessa versão. O Dockerfile falha se não estiver disponível;
  não existe fallback em memória. A imagem Linux final ainda precisa ser construída,
  fixada por digest e ensaiada antes de receber tráfego real.
- Recebe `POST /api/v1/webhooks/evolution`, JSON não comprimido, evento
  `messages.upsert` (mesma normalização do backend), instância exata e IDs não vazios.
  Suporta entrada única ou batch de até 1000 entradas. Limite padrão 10 MiB, igual
  ao parser atual da API; limites efetivos do proxy/emissor precisam ser conferidos.
  Outros eventos, instâncias, formatos ou excessos são rejeitados sem falso ACK.
  Antes de trocar a rota, confirmar que seu escopo contém somente esse contrato.
- Autenticação pelo mesmo `x-evolution-webhook-secret`, comparação de hashes em tempo
  constante. Segredo vem de arquivo protegido, nunca de argumento de linha de comando.
  Headers não são gravados no journal; bytes completos do envelope são preservados.
  Se o próprio envelope contiver informação sensível, ela fica protegida no volume.
- `200 {received:true,processed:false,reason:"CAPTURED"}` significa commit LOCAL
  confirmado, não envio/consumo pelo agente. A API destino continua com seu contrato
  original. Só `200` com `QUEUED` para TODAS as entradas confirma admissão no destino.
  HTML do proxy, resposta parcial, `INSTANCE_MISMATCH`, redirect, erro, timeout ou
  JSON inesperado não liberam a posição. Nunca considerar qualquer 2xx suficiente.

## Persistência, falhas e ordem

SQLite em volume local exclusivo, `WAL` + `synchronous=FULL`, com verificação dos
pragmas e `quick_check` na abertura. O HTTP ACK só é produzido após o COMMIT.
SQLite FULL, erro de commit, disco indisponível ou falha de persistência resultam
em não sucesso. Não simula aceitação de uma mensagem não persistida.

O volume precisa honrar fsync e locking, permanecer montado durante toda a janela
e sobreviver a restart/recriação. Não usar NFS, filesystem efêmero, mesmo volume do
PostgreSQL ou diretório compartilhado com outro projeto. Não prometer proteção
contra perda física do host, storage que não honra flush ou interrupção ANTES da
captura. Não depende de retry da Evolution depois de um ACK de captura confirmado.
O comportamento da imagem customizada antes desse ACK continua não certificado.

Novos journals começam **pausados**; pause/resume persistem. A pausa desliga somente
forwarding, mantém recebimento e não cancela requests já em voo. Não expira leases
artificialmente para acelerar corte. Cada envio usa lease persistido e token de
fencing. Outro dispatcher não pula o head, e ACK antigo não confirma claim novo.
Captura serializa envelopes por ordem de COMMIT local; mantém bytes e ordem interna
do batch. Não transforma isso em ordem física de WhatsApp ou arrival order global.
Somente uma instância de captura é prevista na topologia mínima; testes também
verificam fencing de duas conexões/dispatchers no mesmo journal local.

Reentrega é at-least-once. Falha/ACK perdido gera replay dos mesmos IDs/envelope.
Duplicatas de requests podem existir no journal; a deduplicação é no destino por
`(instanceName,externalMessageId)` e outbox idempotente, já certificados no backend.
Replays atrasados não autorizam reatribuir usuário nem criar uma posição retroativa.
Não há descarte por limite de tentativas: backoff exponencial limitado a 60s,
com tentativas e falha persistidas. Head permanentemente inválido bloqueia os
seguintes para intervenção; não implementar skip silencioso ou dead letter que
permita ultrapassagem. Retry contínuo é espaçado, não um loop agressivo.

Retenção padrão de 7 dias **após** admissão confirmada. Limpeza em lotes de 100,
inclusive em idle/pausa; pendentes não expiram. Espaço livre é reutilizado pelo
SQLite, sem VACUUM automático. `secure_delete` não equivale a apagamento seguro do
WAL/disco; proteger o volume e, conforme política, criptografá-lo na infraestrutura.
Não copiar apenas `capture.sqlite` enquanto aberto: WAL/SHM fazem parte do estado.
Backups do spool exigem SQLite backup consistente ou snapshot atômico apropriado.
Não remover volume/journal enquanto houver backlog ou evidência pendente.

O budget padrão `CAPTURE_MAX_BYTES=268435456` limita páginas da base, não é uma quota
rígida de todos os sidecars WAL/SHM. Dimensionar disco com folga para WAL, requests e
janela, monitorar espaço do host e alarmar antes de saturar. Disco cheio deve impedir
aprovação do corte. Não presumir que a Evolution repetirá requests rejeitados.

## Configuração

Obrigatórios: `CAPTURE_DIRECTORY` absoluto/exclusivo, `CAPTURE_TARGET` URL privada
com path `/api/v1/webhooks/evolution` (sem userinfo/query/fragment),
`EVOLUTION_INSTANCE_NAME` e `EVOLUTION_WEBHOOK_SECRET_FILE`.

Defaults: bind `127.0.0.1`, porta 3180, timeout 15s, poll 1s, lease timeout+30s,
body 10 MiB, base 256 MiB. Porta 0 é apenas útil para testes locais efêmeros.
No container, bind `0.0.0.0` é privado na rede aprovada e publicação host é loopback.
`CAPTURE_TIMEOUT_MS`, `CAPTURE_BODY_LIMIT`, `CAPTURE_MAX_BYTES` aceitam apenas limites
numéricos validados. Segredo e target não aparecem em logs de falha/startup.

No Linux, diretório deve pertencer ao UID efetivo e ter modo 0700; base 0600 e
umask 077. Recusa diretório de outro projeto, marcador inválido, symlinks conhecidos
e base com application_id estranho. O container usa UID/GID **10001** exclusivos,
root filesystem read-only, sem capabilities e sem volumes/credenciais PostgreSQL.
Em Windows de desenvolvimento, chmod não comprova ACL: manter TEMP com ACL privada;
permissões e semântica de flush do volume Linux são gates operacionais adicionais.

`GET /health/live` não acessa dados e só comprova processo vivo.
`GET /metrics` exige o mesmo header secreto e retorna apenas backlog, idade,
tentativas, falhas, leases ativos, pause e quantidade retida. Falhas de entrada/storage
em memória reiniciam com o processo; tentativas/estado da fila são duráveis.
Não publicar métricas/porta sem controle de acesso. Monitorar também WAL, espaço e
latência de commit no host. Liveness verde não comprova capacidade de persistir.

Comandos locais de controle (não mudam flags do backend):

```sh
node gateway.cjs status
node gateway.cjs pause
node gateway.cjs resume
```

Usam o volume/configuração do processo, não criam journal por erro de path nos
comandos de controle. Não imprimir env_file/header/token para consultar métricas.

## Validação local reproduzível

Na raiz do repositório, sem Docker, VPS ou provedores:

```sh
node --test backend/webhook-capture/gateway.test.cjs
node --check backend/webhook-capture/gateway.cjs
```

No diretório backend, usando dependências de desenvolvimento existentes:

```sh
npx eslint --config webhook-capture/eslint.config.cjs webhook-capture/gateway.cjs webhook-capture/gateway.test.cjs webhook-capture/eslint.config.cjs
npx prettier --check webhook-capture/gateway.cjs webhook-capture/gateway.test.cjs webhook-capture/eslint.config.cjs webhook-capture/compose.example.yml
```

Testes usam SQLite real em diretórios TEMP exclusivos, HTTP somente loopback e
processos filhos próprios. Incluem SIGKILL depois do ACK, SIGKILL em transação
não commitada, restart/replay, timeout após destino admitir, FULL real, falha de
commit, fencing, FIFO, batch, ACK parcial, auth, privacidade, retenção e shutdown.
O destino HTTP dos testes é um harness; não é a Evolution customizada nem uma
nova execução PostgreSQL. O contrato/dedup do backend permanece coberto pela
certificação prévia (62 PG por timezone); não substituir essa evidência pelo harness.

## Gates para integrar ao proxy real — nada executado

1. Confirmar por inspeção autorizada: proxy/produto/versão, host versus container,
   rota atual e rewrite, TLS, headers, limites/body encoding, timeout, upstreams,
   redes privadas e porta livre. A imagem informada
   `2.3.7-baileys-rc9-tctoken-patch` não comprova configuração/código do emissor.
   Não alegar journal nativo sem fonte/config/tests correspondentes dessa imagem.
2. Provisionar somente um diretório persistente novo e seu segredo via canal
   protegido, UID/GID10001 e modo0700/arquivo0400. O segredo deve ser compatível com
   o existente, sem modificá-lo ou mostrá-lo. Revisar `compose.example.yml`: todos
   os paths/rede/imagem/porta são variáveis obrigatórias, não defaults de produção.
   Preferir rede dedicada/API ou ACL de saída restrita ao destino necessário.
   Se a rede atual incluir PostgreSQL/outros projetos, revisar segmentação antes
   de conectar; não criar/conectar redes implicitamente.
3. Criar imagens por SHA de commit aprovado: backend/API/workers usam um digest,
   captura usa OUTRO digest do mesmo commit, construído com contexto exclusivo
   `backend/webhook-capture`. Não reconstruir por serviço. Fixar ambos os digests e
   validar Node/SQLite, UID, mounted volume e conteúdo efetivo. A tag node:22 da
   receita não certifica rebuild byte a byte; o deploy é pelo digest aprovado.
4. Iniciar captura pausada, sem redirecionar tráfego. Fazer ensaio em rota privada
   sintética: API inacessível, restart da captura, ACK perdido, pico e storage cheio.
   Provar volume/fsync Linux e recuperação. A falta deste ensaio não pode ser
   ocultada pelos testes Windows. Não usar payloads/clientes reais como fixture.
5. Se proxy no host, o upstream pode ser a porta loopback exclusiva, após inspeção.
   Se proxy em container, seu loopback NÃO é o host: comprovar rede/rota adequada.
   Preparar configuração específica do produto/versão, validar sintaxe e provar
   troca graciosa de upstream sem interromper requests antigos. Não fornecer um
   `nginx reload` genérico como se a VPS necessariamente usasse Nginx.
6. Trocar somente o path/instância autorizados de Evolution, preservando path,
   header e corpo e sem log de payload/header secreto. Outras rotas e PagBank não
   mudam. Manter API antiga enquanto conexões antigas drenam e comprovar fim do
   in-flight. Captura deve estar ATIVA antes de indisponibilizar API/DB.
7. Com forwarding pausado e captura aceitando/commitando, quiescer workers antigos,
   verificar leases/ACKs e executar o preflight histórico abaixo. Só depois iniciar
   a janela de SQL68 já revisada. A API antiga ligada sozinha não protege contra DDL.
8. Nova API e TODOS os workers no mesmo digest, em DRAIN; nenhum consumidor antigo,
   inclusive instâncias host/ALL/inbox direto. Confirmar 68 migrations/checksums.
   Só então `resume` do forwarding; histórico sem sequência deve drenar, novos
   turnos sequenciados aguardam a barreira. Não backfill nem skip de predecessores.
9. Para REQUIRED: `pause`, esperar `activeLeases=0` e API in-flight, quiescer novos
   consumers, trocar os quatro modos coordenadamente, validar imagem/modo e
   retomar forwarding. Gateway continua capturando durante todo o intervalo.
   Não exigir backlog de novas posições zero em DRAIN: a barreira o impede.
10. Rollback: manter captura e binário novo de recuperação; não voltar a workers
    antigos com posições/saídas sequenciadas pendentes. Não remover volume/SQL68,
    apagar receipt, resetar counter nem restaurar backup sobre mensagens novas.

Comandos FUTUROS, sujeitos aos gates acima e nova autorização, não executados:

```sh
# RC é o SHA seletivo aprovado; diretório extraído contém somente arquivos do commit.
docker build --label "org.opencontainers.image.revision=$RC" -t "$CAPTURE_TAG" -f "$RC_TREE/backend/webhook-capture/Dockerfile" "$RC_TREE/backend/webhook-capture"
docker push "$CAPTURE_TAG"
# Confirmar digest no registry e definir CAPTURE_IMAGE=repository@sha256:digest.
# Todas as variáveis obrigatórias do exemplo devem vir do inventário real revisado.
docker compose -f compose.example.yml up -d --no-build --no-deps capture
docker compose -f compose.example.yml exec -T capture node gateway.cjs status
docker compose -f compose.example.yml exec -T capture node gateway.cjs pause
# resume SOMENTE depois da barreira/versão/modo/filas serem aprovados:
docker compose -f compose.example.yml exec -T capture node gateway.cjs resume
```

## Filas históricas e preflight imediatamente antes do corte

Dados fornecidos pelo proprietário, não relidos nesta tarefa: outbox0 FAILED,
18 DEAD_LETTER e1 PENDING futuro; inbox12 FAILED. Não confundir as duas enums.

- OutboxService.claimBatch seleciona PENDING/FAILED elegíveis e PROCESSING com lease
  vencido; NÃO seleciona DEAD_LETTER. Retry de dead letter exige ação administrativa
  auditada. Não reenfileirar os18 nem antecipar o PENDING futuro.
- EvolutionInboundEvent FAILED registra falha de materialização. Não é uma dead
  letter do dispatcher. O worker direto EvolutionInboundWorkerService reclamaria
  RECEIVED/FAILED com attempts<10, porém não está registrado nos módulos atuais;
  comprovar que não existe instância histórica externa/ALL antes do corte.
- O consumidor WHATSAPP do outbox pode reprocessar inbox FAILED se seu evento pai
  for reclamável. Portanto, verificar status, attempts, availableAt e vínculos do
  pai dos12, não inferir segurança apenas de outbox0 FAILED.
- Duplicação do webhook reutiliza inbox e outbox existentes sem zerar attempts;
  captura não executa retry administrativo ou altera status histórico.
- Há reconciliação automática de resposta PROCESSED com outbound não enviado.
  Inventariar também esses candidatos antes de iniciar consumers novos.

`precut-readonly.sql` é SOMENTE um roteiro, não executado pelo gateway. Após parar
forwarding, drenar in-flight e quiescer consumers, executá-lo no banco SingulFit
identificado, com `psql -X -v ON_ERROR_STOP=1`. Ele aborta se surgir outbox FAILED,
se inbox FAILED possuir pai reclamável (inclusive futuro), se houver candidato de
reconciliação automática ou entregas/claims ambíguos. Não altera nada nem imprime
payloads, nomes ou IDs pessoais. Parent ausente/PROCESSED/DEAD_LETTER ainda precisa
ser conciliado com o histórico de COACH e com ausência do worker direto, em revisão
restrita e sem retries. O snapshot precisa permanecer estável até iniciar consumers.
Se qualquer guard falhar, manter captura e parar o avanço; não corrigir com update
em massa, delete, retry genérico ou mudança de assinatura. Preservar a conta ACTIVE
e a conta EXPIRED informadas pelo proprietário.

## Candidato de fonte

Os38 arquivos anteriores permanecem intactos. Adicionam-se oito arquivos somente
neste diretório: `gateway.cjs`, `gateway.test.cjs`, `eslint.config.cjs`, `Dockerfile`,
`.dockerignore`, `compose.example.yml`, `precut-readonly.sql`, `README.md`.
Total pretendido46 caminhos explícitos. Nenhum staging, commit, push, imagem ou
deploy foi executado. A seleção futura deve validar hashes/OIDs dos38 anteriores,
incluir exatamente esses oito e excluir Terms, temporários e .operations-preflight.

Fonte local pronta para revisão; aprovação operacional ainda depende de topologia,
ensaio do volume/imagem Linux, handoff do proxy e preflight histórico. Não declarar
captura real instalada ou VPS certificada a partir desta implementação local.

Referências: [SQLite WAL](https://www.sqlite.org/wal.html),
[synchronous FULL](https://www.sqlite.org/pragma.html#pragma_synchronous),
[Node22 SQLite](https://nodejs.org/download/release/v22.18.0/docs/api/sqlite.html).
