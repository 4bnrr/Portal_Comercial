ESTAÇÃO 1 - CVCRM V5

CAUSA CORRIGIDA
O endpoint /api/v1/cvdw/unidades/situacao não retorna o estado atual no
campo "situacao". Ele retorna o histórico da alteração:
- de_situacao = situação anterior
- para_situacao = situação nova

A versão anterior selecionava corretamente o registro mais recente de cada
unidade, mas não lia "para_situacao". Assim, unidades que tinham histórico
de situação eram normalizadas como "indisponivel", produzindo:
0 empreendimentos comerciais / 0 unidades disponíveis.

V5
- lê para_situacao como fonte prioritária do status;
- mantém o cruzamento por idunidade;
- mantém preços por idunidade;
- lotes de 500;
- intervalo global de 3,2 s (~18,75 req/min) para CVDW;
- sem pausa artificial entre endpoints;
- mantém Retry-After e cooldown após HTTP 429;
- não publica catálogo vazio em caso de falha;
- sincronização automática desativada por padrão.

Execute ATUALIZAR_PARA_CVCRM_V5.bat e depois sincronize uma única vez.
