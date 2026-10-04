-- One model per (source, alias): the fetchers record aliases idempotently (0011).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS lb_aliases_source_alias_key ON lb_aliases (source_key, alias);
