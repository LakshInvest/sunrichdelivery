INSERT INTO public.role_permissions (role_id, module, action)
SELECT r.id, 'dispatch', 'approve'
FROM public.roles r
WHERE r.code = 'DISPATCH'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.module = 'dispatch' AND rp.action = 'approve'
  );