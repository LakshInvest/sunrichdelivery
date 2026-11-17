import {createFileRoute} from "@tanstack/react-router";
import {DriverTaskPage} from "@/components/team/driver-workflow";
import {taskHead} from "@/components/team/task-screen";
export const Route=createFileRoute("/_authenticated/driver/$tripId/")({head:()=>taskHead("Trip home","Your current Sunrich trip and next action."),component:()=> <DriverTaskPage />});
