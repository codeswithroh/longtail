import { readData, type PaperState } from "@/lib/data";

export async function GET() {
  const s = readData<PaperState>("paper-state.json");
  if (!s) return Response.json({ error: "no paper state" }, { status: 404 });
  return Response.json(s.data, { headers: { "cache-control": "no-store" } });
}
