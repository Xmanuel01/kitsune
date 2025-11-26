export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    // Dynamically import the hianime wrapper at request time to avoid
    // pulling `aniwatch` (and its transitive native/test deps) into the
    // Next build bundle. This prevents module-not-found errors for
    // dev/test-only packages like `tap`/`desm`/`fastbench` that some
    // transitive dependencies reference in their test files.
    const mod = await import("@/lib/hianime");
    const { hianime } = mod;
    if (!hianime) throw new Error('hianime module unavailable');
    const data = await hianime.getInfo(id);
    return Response.json({ data });
  } catch (err) {
    console.log(err);
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
