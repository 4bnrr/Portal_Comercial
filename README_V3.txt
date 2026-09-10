ESTAÇÃO 1 - CVCRM V3 COMERCIAL

O que mudou
------------
1. A situação atual da unidade passa a vir prioritariamente de:
   /api/v1/cvdw/unidades/situacao

2. O preço passa a vir prioritariamente de:
   /api/v1/cvdw/unidades/precos

3. O cadastro/identidade da unidade vem de:
   /api/v1/cvdw/unidades

4. Empreendimentos 100% antigos/vendidos deixam de ser exibidos na vitrine
   quando não possuem nenhuma unidade em situação comercial atual.
   Para mostrar todos, adicione ao .env:
   CVCRM_SHOW_SOLD_OUT_ENTERPRISES=true

5. A tabela não mostra mais as colunas "Unidade" e "Tipologia".

6. O botão dos empreendimentos agora é "Ver detalhes".
   Os links são definidos em:
   data\enterprise-links.json

   Exemplo:
   {
     "Nome do empreendimento exatamente como aparece no CVCRM":
       "https://www.seusite.com.br/empreendimento/exemplo"
   }

   Também é possível usar o ID do empreendimento como chave.

7. O simulador mostra SOMENTE unidades:
   - com situação atual = disponível
   - com preço maior que zero retornado pela API

8. A tela Atualizações mostra:
   - quantidade de registros retornados por /unidades
   - quantidade retornada por /unidades/situacao
   - quantidade retornada por /unidades/precos
   - unidades disponíveis
   - unidades disponíveis com preço
   - avisos de erro/403/429/etc.

9. Diagnóstico técnico:
   data\cvcrm-integrity.json

Se houver qualquer falha em situação ou preços, o portal exibirá um aviso
na tela Atualizações. Isso evita apresentar dados como corretos quando uma
das fontes do CVCRM não respondeu corretamente.

Sobre /api/v3/cadastros/pessoas
-------------------------------
Essa API não é necessária para disponibilidade, preços ou simulador.
Ela usa autenticação Bearer v3, diferente do e-mail/token v1 usado pelas APIs CVDW.
Pode ser integrada futuramente para recursos de pessoas/clientes, caso desejado.
