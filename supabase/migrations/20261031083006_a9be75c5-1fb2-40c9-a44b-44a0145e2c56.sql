-- Security fix: finalize loading (creates invoices) belongs to dispatch supervisors, not loaders.
DELETE FROM public.role_permissions rp
USING public.roles r
WHERE rp.role_id = r.id
  AND r.code = 'LOADER'
  AND rp.module = 'dispatch'
  AND rp.action = 'approve';