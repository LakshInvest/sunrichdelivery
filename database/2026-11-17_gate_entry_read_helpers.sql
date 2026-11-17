-- Additive read-only helpers for the guard Entry flow (applied 2026-11-17).
-- gate_staff_directory(): staff name/mobile/photo/role for "Kisse milna hai".
-- gate_request_recipients(request_id): who an approval request went to, for Call / "Phone pe haan bola".
-- Both require has_perm('gate','create') and stay inside the caller's company.
CREATE OR REPLACE FUNCTION public.gate_staff_directory()
RETURNS TABLE(id uuid, full_name text, mobile text, photo_url text, role_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT p.id, p.full_name, p.mobile, p.photo_url,
    (SELECT r.code FROM user_roles ur JOIN roles r ON r.id=ur.role_id AND r.is_active WHERE ur.user_id=p.id ORDER BY r.code LIMIT 1)
  FROM user_profiles p
  WHERE public.has_perm('gate','create') AND p.company_id = public.my_company_id() AND p.user_type='staff' AND p.is_active AND p.full_name IS NOT NULL
  ORDER BY p.full_name;
$$;
REVOKE ALL ON FUNCTION public.gate_staff_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_staff_directory() TO authenticated;

CREATE OR REPLACE FUNCTION public.gate_request_recipients(p_request_id uuid)
RETURNS TABLE(id uuid, full_name text, mobile text, is_host boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT u.id, u.full_name, u.mobile, u.id = r.host_id
  FROM gate_approval_requests r
  JOIN gate_approval_recipients a ON a.request_id = r.id
  JOIN user_profiles u ON u.id = a.user_id AND u.is_active
  WHERE r.id = p_request_id AND r.company_id = public.my_company_id() AND public.has_perm('gate','create')
  ORDER BY (u.id = r.host_id) DESC, u.full_name;
$$;
REVOKE ALL ON FUNCTION public.gate_request_recipients(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gate_request_recipients(uuid) TO authenticated;
