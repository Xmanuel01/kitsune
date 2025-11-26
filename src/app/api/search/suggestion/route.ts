export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") as string;
    const mod = await import("@/lib/hianime");
    const { hianime } = mod;
    if (!hianime) throw new Error('hianime module unavailable');
    const data = await hianime.searchSuggestions(q);
    return Response.json({ data });
  } catch (err) {
    console.log(err);
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
