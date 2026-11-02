DO $do$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public._create_orders'::regproc) INTO d;
  IF position('approved_at, delivery_mode)' in d) = 0 THEN
    d := replace(d, 'placed_by, approved_by, approved_at)', 'placed_by, approved_by, approved_at, delivery_mode)');
    d := replace(d, 'case when v_status = ''approved'' then now() end)
    returning id into v_order;',
      'case when v_status = ''approved'' then now() end,
      case when lower(coalesce(p_delivery ->> ''delivery_mode'', '''')) in (''pickup'',''sunrich'',''distributor'') then lower(p_delivery ->> ''delivery_mode'') end)
    returning id into v_order;');
    IF position('approved_at, delivery_mode)' in d) = 0 OR position('lower(p_delivery ->> ''delivery_mode'')' in d) = 0 THEN
      RAISE EXCEPTION 'patch did not apply';
    END IF;
    EXECUTE d;
  END IF;
END $do$;