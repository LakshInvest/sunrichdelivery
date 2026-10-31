CREATE OR REPLACE FUNCTION public._is_trip_order(p_order_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.trip_stops ts
    JOIN public.trips t ON t.id = ts.trip_id
    WHERE ts.order_id = p_order_id
      AND (t.driver_user_id = auth.uid() OR auth.uid() = ANY (t.helper_user_ids))
  );
$function$;

DROP POLICY IF EXISTS "orders_read_assigned_driver" ON public.orders;
CREATE POLICY "orders_read_assigned_driver"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (public._is_trip_order(orders.id));

DROP POLICY IF EXISTS "order_lines_read_assigned_driver" ON public.order_lines;
CREATE POLICY "order_lines_read_assigned_driver"
  ON public.order_lines
  FOR SELECT
  TO authenticated
  USING (public._is_trip_order(order_lines.order_id));