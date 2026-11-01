import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/driver")({
  head: () => ({
    meta: [
      { title: "My trips · Sunrich Delivery" },
      { name: "description", content: "Your assigned Sunrich delivery trips." },
      { property: "og:title", content: "My trips · Sunrich Delivery" },
      { property: "og:description", content: "Your assigned Sunrich delivery trips." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <Outlet />,
});
