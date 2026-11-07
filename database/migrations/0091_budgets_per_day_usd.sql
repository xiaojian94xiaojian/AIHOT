-- Some paid services bill per returned object rather than per request (X search: $0.0002 per tweet), so a
-- request budget cannot bound what they cost. A positive cap refuses new calls once the last 24 hours'
-- recorded cost reaches it; 0 keeps the service uncapped (its request budgets still apply).
ALTER TABLE budgets ADD COLUMN per_day_usd numeric(10,2) NOT NULL DEFAULT 0;
