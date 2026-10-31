CREATE POLICY "orders_read_assigned_driver"
  ON public.orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.trip_stops ts
      JOIN public.trips t ON t.id = ts.trip_id
      WHERE ts.order_id = orders.id
        AND (t.driver_user_id = auth.uid() OR auth.uid() = ANY (t.helper_user_ids))
    )
  );

CREATE POLICY "order_lines_read_assigned_driver"
  ON public.order_lines
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.trip_stops ts
      JOIN public.trips t ON t.id = ts.trip_id
      WHERE ts.order_id = order_lines.order_id
        AND (t.driver_user_id = auth.uid() OR auth.uid() = ANY (t.helper_user_ids))
    )
  );