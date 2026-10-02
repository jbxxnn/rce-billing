export function GET() {
  return Response.json(
    { status: "ok", service: "rce-billing" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
