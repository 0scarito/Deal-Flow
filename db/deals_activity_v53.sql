-- v53 — Add activity column to deals (CIF / COA regulatory bucket)
-- CIF = Conseiller en Investissements Financiers (financial advisor)
-- COA = Courtier en Opérations d'Assurance (insurance broker)
-- Each deal has ONE activity. Default = CIF (more common at Chamfeuil).
alter table public.deals add column if not exists activity text not null default 'CIF';
-- Backfill existing rows (idempotent — only updates rows where activity is NULL or empty)
update public.deals set activity='CIF' where activity is null or activity='';
-- Add check constraint
alter table public.deals drop constraint if exists deals_activity_check;
alter table public.deals add constraint deals_activity_check check (activity in ('CIF','COA'));
