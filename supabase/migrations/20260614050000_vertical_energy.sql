-- Add the 'energy' vertical for solar & infrastructure drone-inspection leads
-- (solar farms/installers, utilities, substations, telecom towers). Additive —
-- existing enum values are untouched.
alter type public.vertical add value if not exists 'energy';
