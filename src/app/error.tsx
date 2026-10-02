"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-5 p-6">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Temporarily unavailable.</h1>
      <p className="text-sm leading-6 text-muted-foreground">We couldn’t load this page. Please try again.</p>
      <button className="inline-flex h-10 w-fit items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90" onClick={reset}>Try again</button>
    </main>
  );
}
