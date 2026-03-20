export async function GET(request, { params }) {
  const { gameId } = await params;
  try {
    const res = await fetch(
      `https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`,
      { next: { revalidate: 60 } }
    );
    if (!res.ok) return new Response("Not found", { status: res.status });
    const data = await res.json();
    return Response.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
      },
    });
  } catch {
    return new Response("Error", { status: 500 });
  }
}
