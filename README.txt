ESTACAO 1 - PORTAL COMERCIAL LOCAL 2.0
=====================================

VERSAO REFEITA DO ZERO, SEM LOGIN DO PORTAL.

Principais funcionalidades:
- Inicio com indicadores de empreendimentos, unidades disponiveis e menor preco.
- Empreendimentos.
- Tabela de precos com filtros.
- Simulador de entrada/financiamento/subsidio.
- Materiais comerciais com upload local (ate 25 MB por arquivo).
- Pagina de atualizacoes com sincronizacao manual e automatica do CVCRM.
- Historico local de sincronizacoes e publicacao/remocao de materiais.
- Acesso pela rede local na porta 3000.
- Sem MySQL/MariaDB.
- Sem React/Vite/pnpm e sem etapa de build.

INSTALACAO
1) Extraia a pasta preferencialmente para C:\ESTACAO_1.
2) Execute INSTALAR_ESTACAO_1.bat como Administrador.
3) Informe o token do CVCRM quando solicitado.
4) Execute INICIAR_SITE.bat.
5) Acesse http://localhost:3000.

OUTRO COMPUTADOR NA REDE
Acesse http://IP-DO-SERVIDOR:3000.
Use ipconfig no servidor para descobrir o IPv4.

SEGURANCA
O portal deliberadamente nao possui login, conforme solicitado.
Isso significa que qualquer pessoa que consiga acessar a porta 3000 na mesma rede pode consultar o portal e usar as acoes expostas (incluindo sincronizacao e materiais).
O token CVCRM fica somente no arquivo .env do servidor e nunca e enviado ao navegador.

DADOS LOCAIS
- data/cache.json: ultimo catalogo sincronizado.
- data/raw-cvcrm-last.json: resposta bruta da ultima sincronizacao (diagnostico).
- data/materials.json: metadados dos materiais.
- data/uploads/: arquivos enviados.
- data/history.json: historico.
- logs/server.log: log do servidor.

CVCRM
A integracao usa os endpoints CVDW v1:
- /api/v1/cvdw/unidades
- /api/v1/cvdw/unidades/situacao
- /api/v1/cvdw/unidades/precos
A sincronizacao padrao acontece a cada 15 minutos e tambem pode ser disparada manualmente.

CORRECAO DO INICIADOR (v2.1)
- INICIAR_SITE.bat agora usa PowerShell Start-Process para manter o Node em segundo plano.
- Logs separados em logs\server.log e logs\server-error.log.
- DIAGNOSTICAR_SITE.bat executa o servidor em primeiro plano e mostra o erro real.
- TESTAR_SITE.bat testa a API local /api/status.

CORRECAO DE LIMITE CVCRM (HTTP 429)
- Requisicoes ao CVCRM sao serializadas com intervalo minimo de 4,5 segundos.
- Em HTTP 429, o servidor respeita Retry-After quando enviado e faz novas tentativas com espera progressiva.
- A sincronizacao imediata ao iniciar o portal foi removida para evitar duplicidade com o botao Sincronizar agora.
- Se quiser ajustar o intervalo, adicione CVCRM_REQUEST_GAP_MS=4500 ao .env (nao use menos de 3500).


==============================================
VERSAO CVCRM V2 - ESTRUTURA REAL DA API
==============================================
- Parser ajustado para o envelope real:
  pagina / registros / total_de_registros / total_de_paginas / dados.
- Sincroniza unidades em paginas de ate 500 registros.
- Usa os campos situacao_* já presentes no endpoint de unidades.
- Consulta precos separadamente para enriquecer o catalogo.
- Sincronizacao roda em segundo plano e exibe progresso na tela Atualizacoes.
- Se a consulta de precos falhar, as unidades permanecem salvas no portal.
- O token continua somente no arquivo .env e nao e incluido neste pacote.

Para atualizar uma instalacao existente:
1. Pare o site.
2. Copie server.js e a pasta public deste pacote por cima da instalacao atual.
3. Nao substitua o seu arquivo .env.
4. Inicie o site.
5. Abra Atualizacoes > Sincronizar agora.

VERCEL - SINCRONIZACAO PROGRAMADA
- O endpoint /api/cron/sync executa a consulta completa ao CVCRM antes de responder.
- No plano Hobby, o GitHub Actions chama esse endpoint a cada hora.
- O catalogo publicado e preservado em um armazenamento Vercel Blob privado.
- Configure CVCRM_DOMAIN, CVCRM_EMAIL, CVCRM_TOKEN e CRON_SECRET somente nas variaveis de ambiente da Vercel.
- Conecte um Vercel Blob privado ao projeto para criar BLOB_READ_WRITE_TOKEN automaticamente.
- Cadastre o mesmo CRON_SECRET no GitHub com o nome VERCEL_CRON_SECRET.
