# Reparação proposta — relato interpretado como pedido de plano

Este documento não executa SQL nem autoriza efeitos em produção. A execução depende de aprovação explícita, IDs completos e verificação do estado atual.

## Evidência recebida

- Inbound: `bd6cd579-e6ec-4739-b40e-710e44deb5cf`.
- Lembrete HYDRATION_CHECK: `7d1aa7e0-83a3-49a7-b102-f2e9efafc58e`.
- AIJob indevido: `2781df03-1a54-43f4-a874-771a1f676d97`.
- Plano indevido: prefixo `2a553474`, ACTIVE, cinco sessões.
- Plano anterior legítimo: prefixo `d48d4220`, ARCHIVED, duas sessões.
- Receipt semântico COMPLETED com resultado null; eventos da fila já PROCESSED.

Os prefixos não são identificadores suficientes para uma escrita. Não houve acesso ao banco nem confirmação independente desses estados nesta revisão.

## Preparação somente de leitura

1. Obter IDs completos, userId/conversationId, snapshots de ambos os planos e seus dias/exercícios, AIJobs relacionados, autoria, timestamps e histórico de alterações posteriores.
2. Confirmar que o plano anterior foi arquivado por esta persistência indevida e que nenhum pedido legítimo posterior gerou outro plano ativo. Se houve alteração posterior, interromper a restauração proposta e revisar a cronologia.
3. Exportar evidências e registrar operador, motivo, identificador único da reparação e aprovação. Confirmar backup e mecanismo de auditoria existente, sem criar schema.
4. Revisar separadamente o receipt null e os ledgers de resposta/envio. Não resetar receipt, mensagem, AIJob ou eventos para PROCESSING/PENDING; não reapresentar o inbound ao pipeline nem recriar resposta do provider.

## Transação proposta, após aprovação

1. Abrir transação e bloquear os registros dos planos envolvidos e os planos ativos desse usuário, em ordem estável, utilizando o procedimento operacional aprovado.
2. Revalidar IDs, ownership, vínculo ao AIJob, estados e timestamps contra os snapshots aprovados. Exigir que o único ACTIVE seja exatamente o plano indevido. Divergência exige rollback.
3. Arquivar somente esse plano indevido e reativar somente o anterior legítimo. Preservar documentos, dias, exercícios, AIJobs, tentativas, uso e histórico; não apagar evidências nem alterar cobrança.
4. Registrar no mecanismo de auditoria existente os estados anterior/posterior, a justificativa e a aprovação, na mesma transação. Se esse mecanismo não permitir auditoria transacional, interromper e aprovar um procedimento específico antes da execução.
5. Conferir unicidade do ACTIVE e integridade das duas sessões anteriores antes do commit. Qualquer falha provoca rollback integral.

Reexecução deve reconhecer a reparação já auditada e não produzir nova alteração. Se os estados não corresponderem à operação aprovada, parar.

## Resposta ao usuário

Qualquer mensagem corretiva histórica exige autorização separada e revisão do ledger de envio. Usar uma identidade própria da reparação aprovada, preservar o receipt original e garantir um único envio pelo fluxo existente. Este hotfix não reprocessa automaticamente a mensagem histórica nem executa a restauração.

## Incidente CrossFit separado

O arquivo completo `workout-7599936e-evidence.json`, fornecido pelo usuário, confirma seis prescrições PERCENT_1RM sem evidência de 1RM e duas incompatibilidades de execução no Hollow hold (COUNT sem números versus 20-30 s). A reconciliação recupera somente a dose temporal presente. Percentuais sem referência continuam ERROR, agora classificados como UNAUTHORIZED_EXACT_LOAD para permitir o repair já limitado a uma chamada. Não converter percentuais em kg nem inventar capacidade.

As instruções dos aquecimentos W2/W3 oferecem bike sem autorização; W1 declara Bike leve com MACHINE, que não comprova bicicleta. Sábado está fora dos cinco dias confirmados. Esses erros permanecem bloqueantes e reparáveis; não autorizar bike ou sábado por suposição. A fixture reproduz integralmente o candidateOutput recebido. A resposta de repair usada nos testes é controlada e não comprova conclusão em produção. Nenhum job histórico é reexecutado automaticamente.
