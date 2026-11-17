import {createFileRoute} from "@tanstack/react-router";
import {LoaderTaskPage} from "@/components/team/loader-workflow";
import {taskHead} from "@/components/team/task-screen";
export const Route=createFileRoute("/_authenticated/loader/$tripId/$step")({head:({params})=>taskHead(`Loading ${params.step}`,`Sunrich ${params.step} counts.`),component:Task});
function Task(){const {step}=Route.useParams();return <LoaderTaskPage step={step}/>;}
