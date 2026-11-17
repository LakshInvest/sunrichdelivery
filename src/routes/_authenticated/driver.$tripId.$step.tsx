import {createFileRoute} from "@tanstack/react-router";
import {DriverTaskPage} from "@/components/team/driver-workflow";
import {taskHead} from "@/components/team/task-screen";
export const Route=createFileRoute("/_authenticated/driver/$tripId/$step")({validateSearch:(s:Record<string,unknown>):{stopId?:string}=> typeof s.stopId==="string"?{stopId:s.stopId}:{},head:({params})=>taskHead(`Delivery ${params.step}`,`Sunrich delivery ${params.step} task.`),component:Task});
function Task(){const {step}=Route.useParams();const {stopId}=Route.useSearch();return <DriverTaskPage step={step} stopId={stopId}/>;}
