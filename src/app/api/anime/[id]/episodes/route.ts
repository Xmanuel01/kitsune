export async function GET(
  request: Request,
  props: { params: Promise<{ id: string }> },
) {
  const params = await props.params;
  try {
    const { id } = params;
    const mod = await import("@/lib/hianime");
    const { hianime } = mod;
    if (!hianime) throw new Error('hianime module unavailable');
    const data = await hianime.getEpisodes(id);
    return Response.json({ data });
  } catch (err) {
    console.log(err);
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
