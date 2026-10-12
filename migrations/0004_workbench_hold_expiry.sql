-- Copyright (c) 2026 Donald Tuttle. All rights reserved. Proprietary.
-- A timed-out request may still be running at the provider. Keep its tokens
-- charged, but do not leave the concurrency slot held forever.
alter table workbench_quota_reservation add column if not exists expires_ms bigint;
alter table workbench_quota_reservation add column if not exists concurrency_released boolean not null default false;

-- Rows created before expiry existed have no clock of their own.
-- Give each unsettled hold ten minutes from this upgrade so a stuck slot clears itself.
update workbench_quota_reservation
  set expires_ms = (extract(epoch from clock_timestamp()) * 1000)::bigint + 600000
  where settled = false and expires_ms is null;

drop function if exists workbench_reserve(text, text, integer, integer, integer, bigint, integer);

create or replace function workbench_reserve(
  p_period text,
  p_window text,
  p_tokens integer,
  p_rate integer,
  p_daily_requests integer,
  p_daily_tokens bigint,
  p_concurrency integer,
  p_now_ms bigint,
  p_hold_ms bigint
) returns table (ok boolean, reason text, reservation_id text)
language plpgsql
as $$
declare
  v_requests integer;
  v_tokens bigint;
  v_conc integer;
  v_rate integer;
  v_id text;
  v_stale record;
begin
  perform pg_advisory_xact_lock(481516234);

  for v_stale in
    select id, period
    from workbench_quota_reservation
    where settled = false
      and concurrency_released = false
      and expires_ms is not null
      and expires_ms <= p_now_ms
    for update
  loop
    update workbench_quota_period
      set concurrency = greatest(0, concurrency - 1)
      where period = v_stale.period;
    update workbench_quota_reservation
      set concurrency_released = true
      where id = v_stale.id;
  end loop;

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
  select coalesce(sum(concurrency), 0) into v_conc from workbench_quota_period;
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
  insert into workbench_quota_reservation (id, period, reserved_tokens, settled, expires_ms, concurrency_released)
    values (v_id, p_period, p_tokens, false, p_now_ms + p_hold_ms, false);
  return query select true, null::text, v_id;
end;
$$;

create or replace function workbench_reconcile(p_id text, p_actual integer)
returns void language plpgsql as $$
declare
  v_period text;
  v_reserved integer;
  v_settled boolean;
  v_released boolean;
begin
  perform pg_advisory_xact_lock(481516234);
  select period, reserved_tokens, settled, concurrency_released
    into v_period, v_reserved, v_settled, v_released
    from workbench_quota_reservation where id = p_id for update;
  if v_period is null or v_settled then return; end if;
  update workbench_quota_period
    set concurrency = case
          when v_released then concurrency
          else greatest(0, concurrency - 1)
        end,
        tokens = case
          when p_actual is null then tokens
          else greatest(0, tokens - v_reserved + p_actual)
        end
    where period = v_period;
  update workbench_quota_reservation
    set settled = true, concurrency_released = true
    where id = p_id;
end;
$$;
