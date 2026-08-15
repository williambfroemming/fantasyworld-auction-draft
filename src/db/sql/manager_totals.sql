-- Derived budget / roster count / max bid for every manager.
--
-- This is the single source of budget truth. Nothing anywhere stores a budget:
-- the old Google Sheet did, and it drifted to -1 for one manager.
--
-- Because the award and trade statements reference this view inside their WHERE
-- clauses, the max-bid rule is enforced *inside the database* and cannot be
-- bypassed by a bad or stale client.
--
--   budget  = starting_budget - SUM(spent) + SUM(adjustments)
--   max_bid = budget - (roster_size - rostered - 1)      -- reserve $1 per empty slot
--
-- The CASE matters: with a full roster the raw formula yields budget + 1, which
-- is the artifact visible in the old sheet (a manager with $2 left showing a max
-- bid of $3). A full roster can't bid at all, so it clamps to 0.
--
-- ⚠️ The aggregates are scalar subqueries inside a LATERAL, NOT joins. The
-- previous version was `LEFT JOIN picks ... GROUP BY`, which is correct for one
-- table and silently wrong for two: joining budget_adjustments as well would
-- multiply each pick by that manager's adjustment count and inflate every
-- budget. A manager with 3 picks and 2 adjustments would have read as having
-- spent double. Adding a third input here must not reintroduce a join.

CREATE OR REPLACE VIEW manager_totals AS
SELECT
  m.id,
  t.budget,
  t.rostered,
  CASE
    WHEN t.rostered >= d.roster_size THEN 0
    ELSE t.budget - (d.roster_size - t.rostered - 1)
  END AS max_bid
FROM managers m
CROSS JOIN draft d
CROSS JOIN LATERAL (
  SELECT
    (
      d.starting_budget
      - COALESCE((SELECT SUM(p.price) FROM picks p WHERE p.manager_id = m.id), 0)
      + COALESCE((SELECT SUM(a.amount) FROM budget_adjustments a WHERE a.manager_id = m.id), 0)
    )::int                                                          AS budget,
    (SELECT COUNT(*) FROM picks p WHERE p.manager_id = m.id)::int    AS rostered
) t
WHERE d.id = 1;
