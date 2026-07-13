-- The race CSV (T0) is hand-maintained and re-imported as Juan edits it.
-- A natural key on (name, race_date) lets the importer upsert instead of
-- inserting duplicates on every re-run.
alter table races
  add constraint races_name_date_key unique (name, race_date);
