-- Derived budget / roster count / max bid for every manager.
--
-- This is the single source of budget truth. Nothing anywhere stores a budget:
-- the old Google Sheet did, and it drifted to -1 for one manager.
--
-- Because the bid endpoint references this view inside its WHERE clause, the
-- max-bid rule is enforced *inside the database* and cannot be bypassed by a
-- bad or stale client.
--
--   budget  = starting_budget - SUM(spent)
--   max_bid = budget - (roster_size - rostered - 1)      -- reserve $1 per empty slot
--
-- The CASE matters: with a full roster the raw formula yields budget + 1, which
-- is the artifact visible in the old sheet (a manager with $2 left showing a max
-- bid of $3). A full roster can't bid at all, so it clamps to 0.

CREATE OR REPLACE VIEW manager_totals AS
SELECT
  m.id,
  (d.starting_budget - COALESCE(SUM(p.price), 0))::int AS budget,
  COUNT(p.id)::int                                     AS rostered,
  CASE
    WHEN COUNT(p.id) >= d.roster_size THEN 0
    ELSE (
      (d.starting_budget - COALESCE(SUM(p.price), 0))
      - (d.roster_size - COUNT(p.id) - 1)
    )::int
  END AS max_bid
FROM managers m
CROSS JOIN draft d
LEFT JOIN picks p ON p.manager_id = m.id
WHERE d.id = 1
GROUP BY m.id, d.starting_budget, d.roster_size;
