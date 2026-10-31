-- Loader permission change: finalize loading (dispatch approve) removed from LOADER, granted to DISPATCH.
-- Applied 2026-10-31 08:30 UTC.

-- Security fix: finalize loading (creates invoices) belongs to dispatch supervisors, not loaders.
DELETE FROM public.role_permissions rp
USING public.roles r
WHERE rp.role_id = r.id
  AND r.code = 'LOADER'
  AND rp.module = 'dispatch'
  AND rp.action = 'approve';
INSERT INTO public.role_permissions (role_id, module, action)
SELECT r.id, 'dispatch', 'approve'
FROM public.roles r
WHERE r.code = 'DISPATCH'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.module = 'dispatch' AND rp.action = 'approve'
  );