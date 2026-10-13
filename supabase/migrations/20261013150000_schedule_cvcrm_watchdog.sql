create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'cvcrm-watchdog-fallback';

  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'cvcrm-watchdog-fallback',
  '47 0,4,8,12,16,20 * * *',
  $$
    select net.http_post(
      url := (
        select decrypted_secret
          from vault.decrypted_secrets
         where name = 'portal_project_url'
         limit 1
      ) || '/functions/v1/cvcrm-watchdog',
      headers := jsonb_build_object(
        'content-type', 'application/json',
        'x-watchdog-secret', (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'portal_watchdog_secret'
           limit 1
        )
      ),
      body := jsonb_build_object('source', 'supabase-cron'),
      timeout_milliseconds := 15000
    );
  $$
);
