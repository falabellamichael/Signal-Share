create extension if not exists supabase_vault with schema vault;

create or replace function public.get_signal_share_oauth_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select decrypted_secret::jsonb
      from vault.decrypted_secrets
      where name = 'signal_share_social_oauth_config'
      order by updated_at desc
      limit 1
    ),
    '{}'::jsonb
  );
$$;

create or replace function public.set_signal_share_oauth_config(target_config jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
begin
  if target_config is null or jsonb_typeof(target_config) <> 'object' then
    raise exception 'Social OAuth configuration must be a JSON object.';
  end if;

  if target_config - array['x', 'linkedin', 'meta']::text[] <> '{}'::jsonb then
    raise exception 'Social OAuth configuration contains an unsupported provider.';
  end if;

  if octet_length(target_config::text) > 16000 then
    raise exception 'Social OAuth configuration is too large.';
  end if;

  select id
  into existing_secret_id
  from vault.secrets
  where name = 'signal_share_social_oauth_config'
  order by updated_at desc
  limit 1;

  if existing_secret_id is null then
    perform vault.create_secret(
      target_config::text,
      'signal_share_social_oauth_config',
      'Signal Share publishing OAuth application credentials'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      target_config::text,
      'signal_share_social_oauth_config',
      'Signal Share publishing OAuth application credentials'
    );
  end if;
end;
$$;

revoke all on function public.get_signal_share_oauth_config() from public, anon, authenticated;
revoke all on function public.set_signal_share_oauth_config(jsonb) from public, anon, authenticated;
grant execute on function public.get_signal_share_oauth_config() to service_role;
grant execute on function public.set_signal_share_oauth_config(jsonb) to service_role;
