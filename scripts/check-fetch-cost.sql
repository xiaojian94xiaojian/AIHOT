-- The paid side: how many actual search requests, versus the per-source fetch_runs rows (one per
-- source even when a shard shares a single search).
select '=== receipts 里所有 purpose（近 24h）===' as section;
select purpose, count(*) as 次数
  from receipts where created_at > now() - interval '24 hours'
 group by 1 order by 2 desc limit 14;

select '=== services 分布 ===' as section;
select service, count(*) as 次数
  from receipts where created_at > now() - interval '24 hours'
 group by 1 order by 2 desc limit 8;

select '=== fetch_runs 与付费请求的比值（近 24h）===' as section;
select
  (select count(*) from fetch_runs where started_at > now() - interval '24 hours') as fetch_runs行数,
  (select count(*) from receipts where created_at > now() - interval '24 hours') as 付费回执数;
