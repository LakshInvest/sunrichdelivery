import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sunrich Team" },
      { name: "description", content: "Sunrich Team mobile app." },
      { property: "og:title", content: "Sunrich Team" },
      { property: "og:description", content: "Sunrich Team mobile app." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <h1 className="text-2xl font-semibold text-foreground">Sunrich Team</h1>
    </main>
  );
}
