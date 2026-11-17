import {createFileRoute} from "@tanstack/react-router";
import {SecurityTaskPage} from "@/components/team/security-workflow";
import {taskHead} from "@/components/team/task-screen";
export const Route=createFileRoute("/_authenticated/security/")({head:()=>taskHead("Gate home","Scan passes and record Sunrich gate entry and exit."),component:()=> <SecurityTaskPage/>});
