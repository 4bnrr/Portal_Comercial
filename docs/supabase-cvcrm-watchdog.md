# Vigia CVCRM no Supabase

O vigia é executado cinco minutos depois de cada janela de 15 minutos do GitHub Actions. Ele consulta o histórico do workflow e:

- não faz nada quando existe uma execução recente, na fila ou em andamento;
- dispara `workflow_dispatch` quando a última execução bem-sucedida está atrasada;
- nunca consulta o CVCRM diretamente.

## Segredos necessários

Na Edge Function do Supabase:

- `GITHUB_ACTIONS_TOKEN`: token fine-grained limitado ao repositório `4bnrr/Portal_Comercial`, com `Actions: write`;
- `WATCHDOG_SECRET`: valor aleatório forte usado para autenticar o cron.

No Vault do Supabase:

- `portal_project_url`: URL do projeto, como `https://SEU-PROJETO.supabase.co`;
- `portal_watchdog_secret`: o mesmo valor de `WATCHDOG_SECRET`.

Nenhum desses valores deve ser salvo no Git.

## Publicação

1. Vincule este diretório a um projeto Supabase.
2. Cadastre os dois segredos da Edge Function.
3. Cadastre os dois valores no Vault.
4. Publique a função `cvcrm-watchdog` com verificação JWT desativada.
5. Aplique a migration `20261013150000_schedule_cvcrm_watchdog.sql`.
6. Faça uma chamada de teste e confirme o resultado no histórico do Cron.

O cron usa UTC e roda nos minutos `07`, `22`, `37` e `52`. Se a última execução bem-sucedida tiver mais de 5 minutos e não houver outra execução ativa, o vigia dispara uma nova execução. Essa pequena tolerância evita duplicidade logo após uma execução manual sem pular a próxima janela de 15 minutos.
