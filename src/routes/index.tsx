import { createFileRoute, Link } from "@tanstack/react-router";
import { Camera, ScanText, FileDown, CloudUpload, Sparkles, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import heroImage from "@/assets/hero-scan.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flatlay — scan books & documents with OCR" },
      {
        name: "description",
        content:
          "Turn your phone into a book scanner: auto edge crop, shadow and finger removal, curved page flattening, instant text recognition and PDF export.",
      },
      { property: "og:title", content: "Flatlay — scan books & documents with OCR" },
      {
        property: "og:description",
        content:
          "Auto edge crop, shadow removal, curved page flattening, text recognition and PDF export — right in your phone browser.",
      },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: Camera, title: "Auto edge crop", text: "Finds the page and straightens it as you shoot." },
  { icon: BookOpen, title: "Curved page fix", text: "Flattens book curl and trims fingers at the edges." },
  { icon: Sparkles, title: "Shadow removal", text: "Evens out lighting so paper looks clean and white." },
  { icon: ScanText, title: "Text recognition", text: "Copy the words out of any page you scan." },
  { icon: FileDown, title: "Multi-page PDF", text: "Combine pages into one file and share it." },
  { icon: CloudUpload, title: "Cloud saving", text: "Every scan is kept safe in your own library." },
];

function Landing() {
  return (
    <main className="min-h-screen grain">
      <header className="mx-auto flex max-w-md items-center justify-between px-5 pt-6">
        <span className="font-display text-lg font-bold tracking-tight">Flatlay</span>
        <Link to="/auth">
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      <section className="mx-auto max-w-md px-5 pt-10">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Book & doc scanner</p>
        <h1 className="mt-3 text-4xl font-bold leading-[1.05]">
          Every page,
          <br />
          perfectly flat.
        </h1>
        <p className="mt-4 text-base text-muted-foreground">
          Hold your phone over a book or a form. Flatlay crops the page, removes the shadow, flattens the
          curve, reads the text and saves a PDF.
        </p>
        <div className="mt-6 flex gap-3">
          <Link to="/scan" className="flex-1">
            <Button size="lg" className="w-full">
              Start scanning
            </Button>
          </Link>
          <Link to="/library">
            <Button size="lg" variant="secondary">
              My scans
            </Button>
          </Link>
        </div>

        <div className="surface mt-8 overflow-hidden">
          <img
            src={heroImage}
            alt="A phone capturing an open book on a dark desk"
            width={1024}
            height={1280}
            className="h-72 w-full object-cover"
          />
        </div>

        <div className="mt-8 grid gap-3 pb-16">
          {features.map((f) => (
            <div key={f.title} className="surface flex items-start gap-3 p-4">
              <span className="mt-0.5 rounded-full bg-secondary p-2 text-primary">
                <f.icon className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">{f.title}</h2>
                <p className="text-sm text-muted-foreground">{f.text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
