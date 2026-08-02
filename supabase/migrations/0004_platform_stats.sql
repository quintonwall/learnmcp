-- One-row aggregate for the homepage: how many lessons has anyone actually learned here.
-- No PII — just counts — so it's safe to expose to anon.
create or replace view platform_stats as
  select
    (select count(*) from learner_objectives)::int as lessons_completed,
    (select count(*) from learner_badges)::int      as badges_earned,
    (select count(distinct learner_id) from learner_badges)::int as active_learners;

grant select on platform_stats to anon, authenticated;
