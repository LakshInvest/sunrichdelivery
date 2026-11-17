import {createFileRoute} from "@tanstack/react-router";
import {SecurityTaskPage} from "@/components/team/security-workflow";
import {taskHead} from "@/components/team/task-screen";
export const Route=createFileRoute("/_authenticated/security/$step")({validateSearch:(s:Record<string,unknown>):{entryId?:string;tripId?:string}=>({...typeof s["entryId"]==="string"?{entryId:s["entryId"]}:{},...typeof s["tripId"]==="string"?{tripId:s["tripId"]}:{}}),head:({params})=>taskHead(`Gate ${params.step}`,`Sunrich gate ${params.step} task.`),component:Task});
function Task(){const {step}=Route.useParams();const {entryId,tripId}=Route.useSearch();return <SecurityTaskPage step={step} entryId={entryId} tripId={tripId}/>;}
