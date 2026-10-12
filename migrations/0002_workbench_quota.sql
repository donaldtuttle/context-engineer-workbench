-- Deployment-wide paid-request allowance. Rows are unowned.
-- This is a request and token allowance, not a dollar ceiling.

create table if not exists workbench_quota_period (
  period text primary key,
  requests integer not null default 0,
  tokens bigint not null default 0,
  concurrency integer not null default 0
);

create table if not exists workbench_quota_rate (
  window_key text primary key,
  count integer not null default 0
);

create table if not exists workbench_quota_reservation (
  id text primary key,
  period text not null,
  reserved_tokens integer not null,
  settled boolean not null default false
);

create or replace function workbench_reserve(
  p_period text,
  p_window text,
  p_tokens integer,
  p_rate integer,
  p_daily_requests integer,
  p_daily_tokens bigint,
  p_concurrency integer
) returns table (ok boolean, reason text, reservation_id text)
language plpgsql
as $$
declare
  v_requests integer;
  v_tokens bigint;
  v_conc integer;
  v_rate integer;
  v_id text;
begin
  perform pg_advisory_xact_lock(481516234);
  insert into workbench_quota_period (period, requests, tokens, concurrency)
    values (p_period, 0, 0, 0)
    on conflict (period) do nothing;
  select requests, tokens, concurrency into v_requests, v_tokens, v_conc
    from workbench_quota_period where period = p_period for update;
  insert into workbench_quota_rate (window_key, count)
    values (p_window, 0)
    on conflict (window_key) do nothing;
  select count into v_rate from workbench_quota_rate where window_key = p_window for update;

  if v_rate + 1 > p_rate then
    return query select false, 'The per-minute request allowance is exhausted.', null::text;
    return;
  end if;
  if v_requests + 1 > p_daily_requests then
    return query select false, 'The daily request allowance is exhausted.', null::text;
    return;
  end if;
  if v_tokens + p_tokens > p_daily_tokens then
    return query select false, 'The daily token allowance is exhausted.', null::text;
    return;
  end if;
  if v_conc + 1 > p_concurrency then
    return query select false, 'Too many paid requests are already running.', null::text;
    return;
  end if;

  update workbench_quota_rate set count = count + 1 where window_key = p_window;
  update workbench_quota_period
    set requests = requests + 1,
        tokens = tokens + p_tokens,
        concurrency = concurrency + 1
    where period = p_period;
  v_id := md5(random()::text || clock_timestamp()::text || p_window);
  insert into workbench_quota_reservation (id, period, reserved_tokens, settled)
    values (v_id, p_period, p_tokens, false);
  return query select true, null::text, v_id;
end;
$$;

create or replace function workbench_reconcile(p_id text, p_actual integer)
returns void
language plpgsql
as $$
declare
  v_period text;
  v_reserved integer;
  v_settled boolean;
begin
  perform pg_advisory_xact_lock(481516234);
  select period, reserved_tokens, settled into v_period, v_reserved, v_settled
    from workbench_quota_reservation where id = p_id for update;
  if v_period is null or v_settled then
    return;
  end if;
  update workbench_quota_period
    set concurrency = greatest(0, concurrency - 1),
        tokens = case
          when p_actual is null then tokens
          else greatest(0, tokens - v_reserved + p_actual)
        end
    where period = v_period;
  update workbench_quota_reservation set settled = true where id = p_id;
end;
$$;
