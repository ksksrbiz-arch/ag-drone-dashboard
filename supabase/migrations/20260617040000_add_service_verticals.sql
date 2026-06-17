-- Add non-ag service-type verticals so Sortie fits operators beyond agriculture:
-- aerial mapping, structural/asset inspection, land survey, and drone delivery.
-- Additive enum values — existing rows and the ag default are unaffected.
alter type public.vertical add value if not exists 'mapping';
alter type public.vertical add value if not exists 'inspection';
alter type public.vertical add value if not exists 'survey';
alter type public.vertical add value if not exists 'delivery';
