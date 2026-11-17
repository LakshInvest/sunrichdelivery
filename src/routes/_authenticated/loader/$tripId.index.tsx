import {createFileRoute} from "@tanstack/react-router";
import {LoaderTaskPage} from "@/components/team/loader-workflow";
import {taskHead} from "@/components/team/task-screen";
export const Route=createFileRoute("/_authenticated/loader/$tripId/")({head:()=>taskHead("Loading list","Confirm the planned Sunrich vehicle load."),component:()=> <LoaderTaskPage/>});
