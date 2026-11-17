import {createFileRoute,Outlet} from "@tanstack/react-router";
import {SecurityWorkflowProvider} from "@/components/team/security-workflow";
export const Route=createFileRoute("/_authenticated/security")({component:()=> <SecurityWorkflowProvider><Outlet/></SecurityWorkflowProvider>});
