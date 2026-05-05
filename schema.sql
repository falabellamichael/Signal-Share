create extension if not exists pgcrypto;

create table if not exists public.posts (
  id text primary key,
  creator text not null,
  title text not null,
  caption text not null,
  tags text[] not null default '{}',
  media_kind text not null check (media_kind in ('image', 'video', 'audio')),
  source_kind text not null check (source_kind in ('upload', 'youtube', 'spotify')),
  provider text,
  media_url text,
  external_url text,
  embed_url text,
  external_id text,
  label text,
  file_path text,
  file_type text,
  file_size bigint,
  likes integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.posts
add column if not exists author_id uuid references auth.users (id) on delete set null;

create table if not exists public.site_admins (
  email text primary key,
  created_at timestamptz not null default now(),
  check (email = lower(email))
);

create table if not exists public.site_settings (
  id text primary key,
  shell_width integer not null default 1200,
  section_gap integer not null default 24,
  surface_radius integer not null default 32,
  media_fit text not null default 'cover' check (media_fit in ('cover', 'contain')),
  blocked_terms text[] not null default array[
    'asshole',
    'beaner',
    'bitch',
    'chink',
    'cunt',
    'fag',
    'faggot',
    'fuck',
    'gook',
    'kike',
    'motherfucker',
    'nigga',
    'nigger',
    'paki',
    'raghead',
    'retard',
    'shit',
    'slut',
    'spic',
    'tranny',
    'wetback',
    'whore'
  ]::text[],
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null,
  notification_hide_sender boolean not null default false,
  notification_hide_body boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email = lower(email)),
  check (char_length(trim(display_name)) between 2 and 40)
);

create table if not exists public.direct_threads (
  id uuid primary key default gen_random_uuid(),
  user_one_id uuid not null references auth.users (id) on delete cascade,
  user_two_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_one_id <> user_two_id),
  unique (user_one_id, user_two_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.direct_threads (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text,
  attachment_url text,
  attachment_file_path text,
  attachment_name text,
  attachment_type text,
  attachment_size bigint,
  attachment_kind text,
  created_at timestamptz not null default now(),
  check (
    (body is not null and char_length(trim(body)) between 1 and 2000)
    or attachment_url is not null
  ),
  check (attachment_kind is null or attachment_kind in ('image', 'video', 'audio', 'file'))
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('web', 'android', 'android_wear')),
  endpoint text unique,
  p256dh text,
  auth text,
  device_token text unique,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (
    (
      platform = 'web'
      and endpoint is not null
      and p256dh is not null
      and auth is not null
      and device_token is null
    )
    or (
      platform in ('android', 'android_wear')
      and device_token is not null
      and endpoint is null
      and p256dh is null
      and auth is null
    )
  )
);

create table if not exists public.post_likes (
  post_id text not null references public.posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.messages
alter column body drop not null;

alter table public.messages
add column if not exists attachment_url text,
add column if not exists attachment_file_path text,
add column if not exists attachment_name text,
add column if not exists attachment_type text,
add column if not exists attachment_size bigint,
add column if not exists attachment_kind text;

alter table public.messages
drop constraint if exists messages_body_check;

alter table public.messages
drop constraint if exists messages_content_check;

alter table public.messages
add constraint messages_content_check
check (
  (body is not null and char_length(trim(body)) between 1 and 2000)
  or attachment_url is not null
);

alter table public.messages
drop constraint if exists messages_attachment_kind_check;

alter table public.messages
add constraint messages_attachment_kind_check
check (attachment_kind is null or attachment_kind in ('image', 'video', 'audio', 'file'));

alter table public.site_settings
add column if not exists blocked_terms text[] not null default array[
  'asshole',
  'beaner',
  'bitch',
  'chink',
  'cunt',
  'fag',
  'faggot',
  'fuck',
  'gook',
  'kike',
  'motherfucker',
  'nigga',
  'nigger',
  'paki',
  'raghead',
  'retard',
  'shit',
  'slut',
  'spic',
  'tranny',
  'wetback',
  'whore'
]::text[];

create index if not exists direct_threads_user_one_updated_idx
on public.direct_threads (user_one_id, updated_at desc);

create index if not exists direct_threads_user_two_updated_idx
on public.direct_threads (user_two_id, updated_at desc);

create index if not exists messages_thread_created_idx
on public.messages (thread_id, created_at asc);

create index if not exists push_subscriptions_user_platform_idx
on public.push_subscriptions (user_id, platform, updated_at desc);

alter table public.push_subscriptions
drop constraint if exists push_subscriptions_platform_check;

alter table public.push_subscriptions
add constraint push_subscriptions_platform_check
check (platform in ('web', 'android', 'android_wear'));

alter table public.push_subscriptions
drop constraint if exists push_subscriptions_check;

alter table public.push_subscriptions
add constraint push_subscriptions_check
check (
  (
    platform = 'web'
    and endpoint is not null
    and p256dh is not null
    and auth is not null
    and device_token is null
  )
  or (
    platform in ('android', 'android_wear')
    and device_token is not null
    and endpoint is null
    and p256dh is null
    and auth is null
  )
);

create index if not exists post_likes_user_created_idx
on public.post_likes (user_id, created_at desc);

insert into public.site_admins (email)
values ('falabellamichael@gmail.com')
on conflict (email) do nothing;

insert into public.site_admins (email)
values ('falabellasocials@gmail.com')
on conflict (email) do nothing;

insert into public.site_settings (id)
values ('global')
on conflict (id) do nothing;

update public.site_settings
set blocked_terms = array[
  'asshole',
  'beaner',
  'bitch',
  'chink',
  'cunt',
  'fag',
  'faggot',
  'fuck',
  'gook',
  'kike',
  'motherfucker',
  'nigga',
  'nigger',
  'paki',
  'raghead',
  'retard',
  'shit',
  'slut',
  'spic',
  'tranny',
  'wetback',
  'whore'
]::text[]
where id = 'global'
  and (blocked_terms is null or cardinality(blocked_terms) = 0);

create or replace function public.is_signal_share_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.site_admins
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.touch_direct_thread_from_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.direct_threads
  set updated_at = now()
  where id = new.thread_id;

  return new;
end;
$$;

create or replace function public.register_push_subscription(
  subscription_platform text,
  subscription_endpoint text default null,
  subscription_p256dh text default null,
  subscription_auth text default null,
  subscription_device_token text default null,
  subscription_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_platform text := lower(coalesce(subscription_platform, ''));
  current_user_id uuid := auth.uid();
  subscription_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if normalized_platform = 'web' then
    if subscription_endpoint is null or subscription_p256dh is null or subscription_auth is null then
      raise exception 'Incomplete web push subscription.' using errcode = '22023';
    end if;

    insert into public.push_subscriptions (
      user_id,
      platform,
      endpoint,
      p256dh,
      auth,
      user_agent,
      updated_at,
      last_seen_at
    )
    values (
      current_user_id,
      'web',
      subscription_endpoint,
      subscription_p256dh,
      subscription_auth,
      subscription_user_agent,
      now(),
      now()
    )
    on conflict (endpoint)
    do update
      set user_id = excluded.user_id,
          p256dh = excluded.p256dh,
          auth = excluded.auth,
          user_agent = excluded.user_agent,
          updated_at = now(),
          last_seen_at = now()
    returning id into subscription_id;

    return subscription_id;
  end if;

  if normalized_platform in ('android', 'android_wear') then
    if subscription_device_token is null then
      raise exception 'Missing Android device token.' using errcode = '22023';
    end if;

    insert into public.push_subscriptions (
      user_id,
      platform,
      device_token,
      user_agent,
      updated_at,
      last_seen_at
    )
    values (
      current_user_id,
      normalized_platform,
      subscription_device_token,
      subscription_user_agent,
      now(),
      now()
    )
    on conflict (device_token)
    do update
      set user_id = excluded.user_id,
          user_agent = excluded.user_agent,
          updated_at = now(),
          last_seen_at = now()
    returning id into subscription_id;

    return subscription_id;
  end if;

  raise exception 'Unsupported push subscription platform.'
    using errcode = '22023';
end;
$$;

create or replace function public.unregister_push_subscription(
  subscription_platform text,
  subscription_endpoint text default null,
  subscription_device_token text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_platform text := lower(coalesce(subscription_platform, ''));
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if normalized_platform = 'web' then
    delete from public.push_subscriptions
    where user_id = current_user_id
      and platform = 'web'
      and endpoint = subscription_endpoint;
    return;
  end if;

  if normalized_platform in ('android', 'android_wear') then
    delete from public.push_subscriptions
    where user_id = current_user_id
      and platform = normalized_platform
      and device_token = subscription_device_token;
    return;
  end if;

  raise exception 'Unsupported push subscription platform.'
    using errcode = '22023';
end;
$$;

create or replace function public.increment_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.posts
  set likes = likes + 1
  where id = new.post_id;

  return new;
end;
$$;

create or replace function public.decrement_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.posts
  set likes = greatest(likes - 1, 0)
  where id = old.post_id;

  return old;
end;
$$;

create or replace function public.normalize_moderation_text(input_text text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      lower(replace(replace(coalesce(input_text, ''), '’', ''), '''', '')),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.normalize_moderation_text(input_text text)
returns text
language sql
immutable
as $$
  select trim(
    regexp_replace(
      lower(replace(replace(coalesce(input_text, ''), chr(8217), ''), '''', '')),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.get_signal_share_blocked_terms()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select blocked_terms
      from public.site_settings
      where id = 'global'
        and blocked_terms is not null
        and cardinality(blocked_terms) > 0
      limit 1
    ),
    array[
      'asshole',
      'beaner',
      'bitch',
      'chink',
      'cunt',
      'fag',
      'faggot',
      'fuck',
      'gook',
      'kike',
      'motherfucker',
      'nigga',
      'nigger',
      'paki',
      'raghead',
      'retard',
      'shit',
      'slut',
      'spic',
      'tranny',
      'wetback',
      'whore'
    ]::text[]
  );
$$;

create or replace function public.post_contains_blocked_language(
  post_creator text,
  post_title text,
  post_caption text,
  post_tags text[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with normalized_post as (
    select concat_ws(
      ' ',
      public.normalize_moderation_text(post_creator),
      public.normalize_moderation_text(post_title),
      public.normalize_moderation_text(post_caption),
      public.normalize_moderation_text(array_to_string(coalesce(post_tags, '{}'::text[]), ' '))
    ) as content
  ),
  blocked_terms as (
    select public.normalize_moderation_text(term) as term
    from unnest(public.get_signal_share_blocked_terms()) as term
  )
  select exists (
    select 1
    from normalized_post
    cross join blocked_terms
    where blocked_terms.term <> ''
      and position(
        ' ' || blocked_terms.term || ' ' in ' ' || normalized_post.content || ' '
      ) > 0
  );
$$;

create or replace function public.enforce_post_language_moderation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.post_contains_blocked_language(new.creator, new.title, new.caption, new.tags) then
    raise exception 'This post contains blocked language and cannot be published.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

alter table public.posts enable row level security;
alter table public.site_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.direct_threads enable row level security;
alter table public.messages enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.post_likes enable row level security;

grant usage on schema public to anon, authenticated;
grant select on table public.posts to anon, authenticated;
grant insert on table public.posts to authenticated;
grant delete on table public.posts to authenticated;
grant select on table public.site_settings to anon, authenticated;
grant insert on table public.site_settings to authenticated;
grant update on table public.site_settings to authenticated;
grant select, insert, update on table public.profiles to authenticated;
grant select, insert on table public.direct_threads to authenticated;
grant select, insert on table public.messages to authenticated;
grant select, insert, delete on table public.post_likes to authenticated;
grant execute on function public.is_signal_share_admin() to anon, authenticated;
grant execute on function public.set_updated_at() to authenticated;
grant execute on function public.touch_direct_thread_from_message() to authenticated;
grant execute on function public.register_push_subscription(text, text, text, text, text, text) to authenticated;
grant execute on function public.unregister_push_subscription(text, text, text) to authenticated;
grant execute on function public.increment_post_like_count() to authenticated;
grant execute on function public.decrement_post_like_count() to authenticated;
grant execute on function public.normalize_moderation_text(text) to anon, authenticated;
grant execute on function public.get_signal_share_blocked_terms() to anon, authenticated;
grant execute on function public.post_contains_blocked_language(text, text, text, text[]) to anon, authenticated;
grant execute on function public.enforce_post_language_moderation() to authenticated;

drop policy if exists "public can read posts" on public.posts;
create policy "public can read posts"
on public.posts
for select
to anon, authenticated
using (true);

drop policy if exists "public can read site settings" on public.site_settings;
create policy "public can read site settings"
on public.site_settings
for select
to anon, authenticated
using (true);

drop policy if exists "authenticated can read profiles" on public.profiles;
create policy "authenticated can read profiles"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "users can insert own profile" on public.profiles;
create policy "users can insert own profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "public can create posts" on public.posts;
drop policy if exists "authenticated can create posts" on public.posts;
create policy "authenticated can create posts"
on public.posts
for insert
to authenticated
with check (
  (select auth.uid()) is not null
  and author_id = (select auth.uid())
  and (
    source_kind <> 'upload'
    or media_kind not in ('image', 'video', 'audio')
    or public.is_signal_share_admin()
  )
);

drop policy if exists "authors and admins can delete posts" on public.posts;
create policy "authors and admins can delete posts"
on public.posts
for delete
to authenticated
using (
  author_id = (select auth.uid())
  or public.is_signal_share_admin()
);

drop policy if exists "participants can read direct threads" on public.direct_threads;
create policy "participants can read direct threads"
on public.direct_threads
for select
to authenticated
using (
  user_one_id = (select auth.uid())
  or user_two_id = (select auth.uid())
);

drop policy if exists "participants can create direct threads" on public.direct_threads;
create policy "participants can create direct threads"
on public.direct_threads
for insert
to authenticated
with check (
  user_one_id = (select auth.uid())
  or user_two_id = (select auth.uid())
);

drop policy if exists "participants can read messages" on public.messages;
create policy "participants can read messages"
on public.messages
for select
to authenticated
using (
  exists (
    select 1
    from public.direct_threads
    where public.direct_threads.id = public.messages.thread_id
      and (
        public.direct_threads.user_one_id = (select auth.uid())
        or public.direct_threads.user_two_id = (select auth.uid())
      )
  )
);

drop policy if exists "participants can create messages" on public.messages;
create policy "participants can create messages"
on public.messages
for insert
to authenticated
with check (
  sender_id = (select auth.uid())
  and exists (
    select 1
    from public.direct_threads
    where public.direct_threads.id = public.messages.thread_id
      and (
        public.direct_threads.user_one_id = (select auth.uid())
        or public.direct_threads.user_two_id = (select auth.uid())
      )
  )
);

drop policy if exists "users can read own post likes" on public.post_likes;
create policy "users can read own post likes"
on public.post_likes
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "users can insert own post likes" on public.post_likes;
create policy "users can insert own post likes"
on public.post_likes
for insert
to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "users can delete own post likes" on public.post_likes;
create policy "users can delete own post likes"
on public.post_likes
for delete
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "admins can insert site settings" on public.site_settings;
create policy "admins can insert site settings"
on public.site_settings
for insert
to authenticated
with check (public.is_signal_share_admin());

drop policy if exists "admins can update site settings" on public.site_settings;
create policy "admins can update site settings"
on public.site_settings
for update
to authenticated
using (public.is_signal_share_admin())
with check (public.is_signal_share_admin());

drop trigger if exists set_site_settings_updated_at on public.site_settings;
create trigger set_site_settings_updated_at
before update on public.site_settings
for each row
execute function public.set_updated_at();

drop trigger if exists enforce_post_language_moderation_on_posts on public.posts;
create trigger enforce_post_language_moderation_on_posts
before insert or update on public.posts
for each row
execute function public.enforce_post_language_moderation();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

drop trigger if exists set_direct_threads_updated_at on public.direct_threads;
create trigger set_direct_threads_updated_at
before update on public.direct_threads
for each row
execute function public.set_updated_at();

drop trigger if exists touch_direct_threads_from_messages on public.messages;
create trigger touch_direct_threads_from_messages
after insert on public.messages
for each row
execute function public.touch_direct_thread_from_message();

drop trigger if exists post_likes_after_insert on public.post_likes;
create trigger post_likes_after_insert
after insert on public.post_likes
for each row
execute function public.increment_post_like_count();

drop trigger if exists post_likes_after_delete on public.post_likes;
create trigger post_likes_after_delete
after delete on public.post_likes
for each row
execute function public.decrement_post_like_count();

insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

drop policy if exists "public can read media" on storage.objects;
create policy "public can read media"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'media');

drop policy if exists "public can upload media" on storage.objects;
drop policy if exists "authenticated can upload media" on storage.objects;
create policy "authenticated can upload media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'media'
  and (select auth.uid()) is not null
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "authors and admins can delete media" on storage.objects;
create policy "authors and admins can delete media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'media'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.is_signal_share_admin()
  )
);

do $$
begin
  begin
    alter publication supabase_realtime add table public.profiles;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.direct_threads;
  exception
    when duplicate_object then null;
  end;

  begin
    alter publication supabase_realtime add table public.messages;
  exception
    when duplicate_object then null;
  end;
end;
$$;
