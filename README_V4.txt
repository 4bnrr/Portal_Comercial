ESTAÇÃO 1 — CVCRM V4 / SINCRONIZAÇÃO SEGURA

A V4 foi feita para impedir que o limite HTTP 429 do CVCRM deixe o portal
com dados vazios ou incorretos.

COMO FUNCIONA
1. Respeita qualquer cooldown 429 persistido.
2. Baixa /api/v1/cvdw/unidades com até 500 registros por página.
3. Aguarda 30 segundos.
4. Baixa /api/v1/cvdw/unidades/situacao.
5. Aguarda 30 segundos.
6. Baixa /api/v1/cvdw/unidades/precos.
7. Cruza tudo em memória.
8. Valida o resultado.
9. Só então substitui data/cache.json.

PROTEÇÕES
- Uma requisição por vez.
- Intervalo mínimo de 6 segundos (~10 req/min).
- Após HTTP 429, aguarda no mínimo 60 segundos.
- Retry-After do CVCRM é respeitado.
- Reincidência aumenta o tempo de espera.
- Estado do 429 é persistido em data/cvcrm-rate-limit.json.
- Clique repetido em Sincronizar não cria outra rotina.
- Sincronização automática desativada por padrão.
- Se qualquer etapa falhar, o catálogo anterior permanece intacto.

DIAGNÓSTICO
data/cvcrm-integrity.json
data/cvcrm-rate-limit.json
data/raw-cvcrm-last.json

INSTALAÇÃO
Execute ATUALIZAR_PARA_CVCRM_V4.bat.

Destino configurado:
C:\Users\abner.silva\Desktop\Nova pasta\ESTACAO_1_CVCRM_V3_COMERCIAL
