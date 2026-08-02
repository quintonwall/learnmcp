-- `learners.handle` already has a case-SENSITIVE unique constraint, so "Quinton" and
-- "quinton" could both be claimed as distinct handles — on a public leaderboard that reads
-- as impersonation, not a coincidence. Add a second, case-insensitive uniqueness rule
-- alongside it. Multiple NULLs are still allowed (unclaimed learners), since a unique
-- index never considers NULL equal to NULL.
create unique index if not exists learners_handle_lower_idx on learners (lower(handle));
