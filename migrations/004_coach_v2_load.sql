-- Coach v2 separates three questions that cannot share one load curve:
--   1. How much running-specific fitness/fatigue is present?
--   2. How much transferable aerobic work is present (run/ride/swim/etc.)?
--   3. How much total recent training load is present, including strength work?
--
-- Legacy ctl/atl/tsb now consistently mean RUNNING CTL/ATL/TSB. The additional
-- curves are deliberately not subtracted from one another: total fatigue minus
-- running fitness is not a physiologically interpretable "form" score.

alter table fitness_state
  add column aerobic_ctl  double precision,
  add column aerobic_atl  double precision,
  add column total_ctl    double precision,
  add column total_atl    double precision,
  add column total_tsb    double precision,
  add column running_load double precision,
  add column aerobic_load double precision,
  add column total_load   double precision;
