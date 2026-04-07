export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ServerCategory = "sub" | "dub" | "raw";

function sanitizeEpisodeId(raw?: string | null) {
  if (!raw) return null;
  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // ignore invalid encodings
  }

  const match = decoded.match(/^([^?]+)(\?ep=(\d+))?/);
  if (!match) return decoded.split("?")[0];
  return match[1] + (match[3] ? `?ep=${match[3]}` : "");
}

function resolveRequestedServer(
  servers: any,
  category: ServerCategory,
  preferredServer?: string | null,
) {
  const requestedList = Array.isArray(servers?.[category]) ? servers[category] : [];
  const subList = Array.isArray(servers?.sub) ? servers.sub : [];
  const dubList = Array.isArray(servers?.dub) ? servers.dub : [];
  const rawList = Array.isArray(servers?.raw) ? servers.raw : [];
  const matched =
    preferredServer &&
    requestedList.find((server: any) => server?.serverName === preferredServer);

  if (matched?.serverName) {
    return {
      category,
      serverName: matched.serverName,
    };
  }

  if (preferredServer) {
    const mirroredMatch = [...subList, ...dubList, ...rawList].find(
      (server: any) => server?.serverName === preferredServer,
    );

    if (mirroredMatch?.serverName) {
      return {
        category,
        serverName: mirroredMatch.serverName,
      };
    }
  }

  if (requestedList[0]?.serverName) {
    return {
      category,
      serverName: requestedList[0].serverName,
    };
  }

  const mirroredFallback = [...subList, ...dubList, ...rawList].find(
    (server: any) => server?.serverName,
  );

  if (mirroredFallback?.serverName) {
    return {
      category,
      serverName: mirroredFallback.serverName,
    };
  }

  const fallbackOrder: ServerCategory[] = ["sub", "dub", "raw"];
  for (const key of fallbackOrder) {
    const list = Array.isArray(servers?.[key]) ? servers[key] : [];
    if (list[0]?.serverName) {
      return {
        category,
        serverName: list[0].serverName,
      };
    }
  }

  return null;
}

export async function GET(req: Request) {
  try {
    const requestUrl = new URL(req.url);
    const origin = requestUrl.origin;
    const episodeId = sanitizeEpisodeId(
      requestUrl.searchParams.get("animeEpisodeId"),
    );
    const category =
      (requestUrl.searchParams.get("category") as ServerCategory | null) || "sub";
    const preferredServer = requestUrl.searchParams.get("server");
    const episodeNumber = requestUrl.searchParams.get("episodeNumber");

    if (!episodeId) {
      return Response.json(
        { error: "animeEpisodeId is required" },
        { status: 400 },
      );
    }

    const serversResponse = await fetch(
      `${origin}/api/episode/servers?animeEpisodeId=${encodeURIComponent(episodeId)}`,
      {
        cache: "no-store",
      },
    );

    if (!serversResponse.ok) {
      const payload = await serversResponse.text();
      return Response.json(
        { error: "Failed to resolve episode servers", details: payload },
        { status: serversResponse.status },
      );
    }

    const serversPayload = await serversResponse.json();
    const servers = serversPayload.data;
    const selected = resolveRequestedServer(servers, category, preferredServer);

    if (!selected) {
      return Response.json(
        { error: "No episode servers are available" },
        { status: 502 },
      );
    }

    const sourceParams = new URLSearchParams({
      animeEpisodeId: episodeId,
      category: selected.category,
      server: selected.serverName,
    });

    const resolvedEpisodeNumber = episodeNumber || String(servers?.episodeNo || "");
    if (resolvedEpisodeNumber) {
      sourceParams.set("episodeNumber", resolvedEpisodeNumber);
    }

    const sourceResponse = await fetch(
      `${origin}/api/episode/sources?${sourceParams.toString()}`,
      {
        cache: "no-store",
      },
    );

    if (!sourceResponse.ok) {
      const payload = await sourceResponse.text();
      return Response.json(
        { error: "Failed to resolve episode source", details: payload },
        { status: sourceResponse.status },
      );
    }

    const sourcePayload = await sourceResponse.json();
    return Response.json(
      {
        data: {
          servers,
          source: sourcePayload.data,
          selected,
          serversFromCache: Boolean(serversPayload.fromCache),
          sourceFromCache: Boolean(sourcePayload.fromCache),
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: any) {
    console.error("[EPISODE_PLAYER] route error", error);
    return Response.json({ error: "something went wrong" }, { status: 500 });
  }
}
