import {createFileRoute,Outlet} from "@tanstack/react-router";
import {LoaderWorkflowProvider} from "@/components/team/loader-workflow";
export const Route=createFileRoute("/_authenticated/loader/$tripId")({component:Layout});
function Layout(){const {tripId}=Route.useParams();return <LoaderWorkflowProvider tripId={tripId}><Outlet/></LoaderWorkflowProvider>;}
