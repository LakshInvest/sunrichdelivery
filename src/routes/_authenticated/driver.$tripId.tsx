import { createFileRoute, Outlet } from "@tanstack/react-router";
import { DriverWorkflowProvider } from "@/components/team/driver-workflow";
export const Route = createFileRoute("/_authenticated/driver/$tripId")({ component: TripLayout });
function TripLayout() { const {tripId}=Route.useParams();return <DriverWorkflowProvider tripId={tripId}><Outlet /></DriverWorkflowProvider>; }
