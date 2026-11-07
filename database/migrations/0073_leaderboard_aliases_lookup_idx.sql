-- Matching a source's own model name to a model row.
CREATE INDEX CONCURRENTLY IF NOT EXISTS lb_aliases_lookup_idx ON lb_aliases (source_key, normalized_alias);
