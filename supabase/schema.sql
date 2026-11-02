-- Finanças da Casa — banco de dados no Supabase
-- Cole tudo no SQL Editor do Supabase e clique em "Run". Pode rodar de novo sem problema.

create extension if not exists pgcrypto;

-- ---------- Tabelas ----------
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  nome text not null default 'Nossa casa',
  codigo text not null unique default upper(substr(md5(random()::text), 1, 6)),
  criado_em timestamptz not null default now()
);

create table if not exists public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nome text not null default '',
  criado_em timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table if not exists public.config (
  household_id uuid primary key references public.households(id) on delete cascade,
  pessoas jsonb not null default '[]',
  categorias jsonb not null default '[]',
  receitas jsonb not null default '["Salário","Renda extra","Outros"]'
);

create table if not exists public.lancamentos (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  tipo text not null check (tipo in ('despesa','receita')),
  valor numeric(12,2) not null check (valor >= 0),
  descricao text not null default '',
  categoria text not null default 'Outros',
  data date not null default current_date,
  quem text not null default '',
  conta_id uuid,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists lancamentos_hh_data on public.lancamentos (household_id, data);

create table if not exists public.contas (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  nome text not null,
  valor numeric(12,2) not null default 0,
  dia int not null default 10 check (dia between 1 and 31),
  categoria text not null default 'Contas da casa',
  pagas jsonb not null default '{}',
  criado_em timestamptz not null default now()
);

create table if not exists public.metas (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  nome text not null,
  alvo numeric(12,2) not null default 0,
  atual numeric(12,2) not null default 0,
  criado_em timestamptz not null default now()
);

-- ---------- Quem é membro de qual casa ----------
create or replace function public.is_member(hh uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where household_id = hh and user_id = auth.uid());
$$;

-- ---------- Segurança: cada casal só vê e mexe nos próprios dados ----------
alter table public.households  enable row level security;
alter table public.members     enable row level security;
alter table public.config      enable row level security;
alter table public.lancamentos enable row level security;
alter table public.contas      enable row level security;
alter table public.metas       enable row level security;

drop policy if exists hh_select on public.households;
create policy hh_select on public.households for select using (public.is_member(id));
drop policy if exists hh_update on public.households;
create policy hh_update on public.households for update using (public.is_member(id));

drop policy if exists mem_select on public.members;
create policy mem_select on public.members for select using (public.is_member(household_id));
drop policy if exists mem_update on public.members;
create policy mem_update on public.members for update using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['config','lancamentos','contas','metas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for all using (public.is_member(household_id)) with check (public.is_member(household_id))', t || '_all', t);
  end loop;
end $$;

-- ---------- Criar a casa e entrar com o código de convite ----------
create or replace function public.criar_casa(meu_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  if auth.uid() is null then raise exception 'Faça login primeiro'; end if;
  insert into households default values returning id into hh;
  insert into members (household_id, user_id, nome) values (hh, auth.uid(), coalesce(nullif(trim(meu_nome),''),'Pessoa 1'));
  insert into config (household_id, pessoas, categorias) values (
    hh,
    jsonb_build_array(coalesce(nullif(trim(meu_nome),''),'Pessoa 1')),
    '[{"nome":"Moradia","limite":0},{"nome":"Mercado","limite":0},{"nome":"Contas da casa","limite":0},{"nome":"Transporte","limite":0},{"nome":"Saúde","limite":0},{"nome":"Educação","limite":0},{"nome":"Filhos","limite":0},{"nome":"Lazer","limite":0},{"nome":"Restaurantes","limite":0},{"nome":"Assinaturas","limite":0},{"nome":"Outros","limite":0}]'
  );
  insert into metas (household_id, nome) values (hh, 'Reserva de emergência');
  return hh;
end $$;

create or replace function public.entrar_na_casa(cod text, meu_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid; nm text := coalesce(nullif(trim(meu_nome),''),'Pessoa 2');
begin
  if auth.uid() is null then raise exception 'Faça login primeiro'; end if;
  select id into hh from households where codigo = upper(trim(cod));
  if hh is null then raise exception 'Código não encontrado'; end if;
  insert into members (household_id, user_id, nome) values (hh, auth.uid(), nm)
    on conflict (household_id, user_id) do nothing;
  update config set pessoas = pessoas || to_jsonb(nm)
    where household_id = hh and not (pessoas ? nm);
  return hh;
end $$;

grant execute on function public.criar_casa(text) to authenticated;
grant execute on function public.entrar_na_casa(text, text) to authenticated;

-- ---------- Atualização em tempo real entre os dois celulares ----------
do $$
declare t text;
begin
  foreach t in array array['config','lancamentos','contas','metas'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
