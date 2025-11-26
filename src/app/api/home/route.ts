export async function GET() {
  try {
    const mod = await import("@/lib/hianime");
    const { hianime } = mod;
    if (!hianime) throw new Error('hianime module unavailable');
    const data = await hianime.getHomePage();
    return Response.json({ data });
  } catch (err) {
    console.log(err);
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
