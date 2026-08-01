create or replace function public.update_signal_share_oauth_provider(
  target_provider text,
  target_provider_config jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_secret_id uuid;
  existing_config jsonb;
  next_config jsonb;
begin
  if target_provider not in ('x', 'linkedin', 'meta') then
    raise exception 'Social OAuth provider is unsupported.';
  end if;

  if target_provider_config is not null then
    if jsonb_typeof(target_provider_config) <> 'object' then
      raise exception 'Social OAuth provider configuration must be an object.';
    end if;

    if target_provider_config - array['clientId', 'clientSecret']::text[] <> '{}'::jsonb
      or not (target_provider_config ? 'clientId')
      or not (target_provider_config ? 'clientSecret')
      or jsonb_typeof(target_provider_config -> 'clientId') <> 'string'
      or jsonb_typeof(target_provider_config -> 'clientSecret') <> 'string'
    then
      raise exception 'Social OAuth provider configuration is invalid.';
    end if;

    if octet_length(target_provider_config ->> 'clientId') = 0
      or octet_length(target_provider_config ->> 'clientId') > 500
      or octet_length(target_provider_config ->> 'clientSecret') > 2000
    then
      raise exception 'Social OAuth provider configuration has an invalid length.';
    end if;

    if target_provider in ('linkedin', 'meta')
      and octet_length(target_provider_config ->> 'clientSecret') = 0
    then
      raise exception 'This Social OAuth provider requires a client secret.';
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(742183, 817264);

  select id, decrypted_secret::jsonb
  into existing_secret_id, existing_config
  from vault.decrypted_secrets
  where name = 'signal_share_social_oauth_config'
  order by updated_at desc
  limit 1;

  existing_config := coalesce(existing_config, '{}'::jsonb);
  if jsonb_typeof(existing_config) <> 'object' then
    raise exception 'Stored Social OAuth configuration is invalid.';
  end if;

  next_config := case
    when target_provider_config is null then existing_config - target_provider
    else jsonb_set(existing_config, array[target_provider], target_provider_config, true)
  end;

  if octet_length(next_config::text) > 16000 then
    raise exception 'Social OAuth configuration is too large.';
  end if;

  if existing_secret_id is null then
    perform vault.create_secret(
      next_config::text,
      'signal_share_social_oauth_config',
      'Signal Share publishing OAuth application credentials'
    );
  else
    perform vault.update_secret(
      existing_secret_id,
      next_config::text,
      'signal_share_social_oauth_config',
      'Signal Share publishing OAuth application credentials'
    );
  end if;
end;
$$;

revoke all on function public.update_signal_share_oauth_provider(text, jsonb)
from public, anon, authenticated;
grant execute on function public.update_signal_share_oauth_provider(text, jsonb)
to service_role;
