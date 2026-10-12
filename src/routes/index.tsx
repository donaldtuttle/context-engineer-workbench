import { createFileRoute } from "@tanstack/react-router";
import { WorkbenchApp } from "@/components/workbench/WorkbenchApp";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <WorkbenchApp />;
}
