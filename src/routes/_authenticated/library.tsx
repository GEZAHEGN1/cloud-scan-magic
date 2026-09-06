import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Camera, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "My scans — Flatlay" },
      { name: "description", content: "All the documents and books you have scanned, ready to open or share." },
      { property: "og:title", content: "My scans — Flatlay" },
      { property: "og:description", content: "All the documents and books you have scanned." },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, title, created_at, pages(count)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <main className="min-h-screen bg-background px-4 pb-24 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My scans</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/" });
          }}
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && !data?.length && (
        <div className="surface p-6 text-center">
          <p className="text-sm text-muted-foreground">Nothing here yet. Scan your first page.</p>
        </div>
      )}

      <div className="grid gap-3">
        {data?.map((doc) => (
          <Link key={doc.id} to="/doc/$docId" params={{ docId: doc.id }} className="surface block p-4">
            <p className="font-medium">{doc.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {(doc.pages as unknown as { count: number }[])?.[0]?.count ?? 0} pages ·{" "}
              {new Date(doc.created_at).toLocaleDateString()}
            </p>
          </Link>
        ))}
      </div>

      <Link to="/scan" className="fixed inset-x-4 bottom-6 mx-auto block max-w-md">
        <Button size="lg" className="w-full shadow-[var(--shadow-glow)]">
          <Camera className="mr-2 h-4 w-4" /> New scan
        </Button>
      </Link>
    </main>
  );
}
