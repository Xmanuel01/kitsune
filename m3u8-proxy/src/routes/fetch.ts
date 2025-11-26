import { Router, type Request, type Response } from "express";
import axios, { AxiosError } from "axios";
import crypto from "crypto";
import debugLib from "debug";
import NodeCache from "node-cache";
import { v4 as uuidv4 } from "uuid";

const router = Router();
const debug = debugLib("proxy:debug");

// Cache maps resourceId -> { url, ref }
// TTL = 600s = 10 minutes (matches signed URL expiry)
const cache = new NodeCache({ stdTTL: 600 });

/**
 * SECRET_KEY
 * - Used to sign segment URLs with an HMAC
 * - Prevents clients from forging /fetch/segment/resource URLs
 * - In production, override this via env with a long random string
 */
const SECRET_KEY = process.env.SECRET_KEY || "update-this-secret";

/**
 * buildHeaders
 * - Construct outbound headers that resemble a browser request
 * - Include Referer/Origin if provided
 */
function buildHeaders(ref?: string) {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    Accept:
      "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  if (ref) {
    headers["Referer"] = ref;
    headers["Origin"] = ref;
  }

  return headers;
}

/**
 * generateSignedUrl
 * - Creates a signature for a resourceId
 * - Adds an expiration time (UNIX timestamp, 10 minutes from now)
 * - Returns a local endpoint:
 *   /fetch/segment/resource?resourceId=xxx&sig=yyy&exp=zzz
 */
function generateSignedUrl(resourceId: string, type: "segment"): string {
  const exp = Math.floor(Date.now() / 1000) + 600; // 600 seconds
  const signature = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(`${resourceId}${exp}${type}`)
    .digest("hex");

  return `/fetch/segment/resource?resourceId=${resourceId}&sig=${signature}&exp=${exp}`;
}

/**
 * verifySignedUrl
 * - Checks if the signature matches
 * - Checks if the expiration hasn't passed
 */
function verifySignedUrl(
  resourceId: string,
  sig: string,
  exp: string,
  type: "segment"
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (parseInt(exp, 10) < now) {
    return false;
  }

  const expectedSig = crypto
    .createHmac("sha256", SECRET_KEY)
    .update(`${resourceId}${exp}${type}`)
    .digest("hex");

  return sig === expectedSig;
}

/**
 * GET /fetch
 * - Fetches a remote M3U8 based on ?url=<remote-m3u8>.
 * - Rewrites:
 *   - nested .m3u8 lines → /fetch?url=...&ref=...
 *   - media segments     → /fetch/segment/resource?resourceId=...&sig=...&exp=...
 * - ref parameter is optional and can be used to set the Referer header.
 */
router.get("/", async (req: Request, res: Response) => {
  const { url, ref } = req.query;

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "No URL provided" });
  }

  try {
    debug(`Fetching M3U8 file from: ${url}`);

    const refHeader =
      (typeof ref === "string" && ref) ||
      process.env.DEFAULT_REF ||
      "https://megacloud.blog/";

    const headers = buildHeaders(refHeader);

    const response = await axios.get(url, {
      responseType: "text",
      headers,
      // do not throw on non-2xx; handle status manually
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      debug(
        `Upstream M3U8 error. status=${response.status} url=${url} data=${String(
          response.data
        ).slice(0, 200)}`
      );
      res.status(response.status);
      return res.send(
        response.data ||
          `Upstream error while fetching playlist (${response.status})`
      );
    }

    const m3u8Content = String(response.data);

    if (!m3u8Content.startsWith("#EXTM3U")) {
      debug("Not a valid M3U8 (no #EXTM3U at start), returning raw content");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.send(m3u8Content);
    }

    const lines = m3u8Content.split("\n");

    const transformed = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        // Comment or empty line → keep as-is
        return line;
      }

      // Resolve relative → absolute against the playlist URL
      const absoluteUrl = new URL(trimmed, url).href;

      // 1) If this line points to another .m3u8, treat it as a nested playlist
      if (absoluteUrl.endsWith(".m3u8")) {
        const nested = `/fetch?url=${encodeURIComponent(
          absoluteUrl
        )}&ref=${encodeURIComponent(refHeader)}`;
        debug(`Rewriting nested playlist: "${trimmed}" -> "${nested}"`);
        return nested;
      }

      // 2) Otherwise, treat it as a media segment URL
      const resourceId = uuidv4();

      // Store both the absolute URL and the original ref
      cache.set(resourceId, {
        url: absoluteUrl,
        ref: refHeader,
      });

      const signedUrl = generateSignedUrl(resourceId, "segment");
      debug(`Rewriting segment: "${trimmed}" -> "${signedUrl}"`);
      return signedUrl;
    });

    const newM3U8 = transformed.join("\n");

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.send(newM3U8);
    debug("Rewritten M3U8 sent to client");
  } catch (error) {
    if ((error as AxiosError).isAxiosError) {
      const ae = error as AxiosError;
      debug(
        `Failed to proxy M3U8. AxiosError status=${ae.response?.status} message=${
          ae.message
        } data=${String(ae.response?.data).slice(0, 200)}`
      );
    } else {
      debug(`Failed to proxy M3U8. Error: ${(error as Error).message}`);
    }
    res.status(500).json({ error: "Failed to fetch M3U8 content" });
  }
});

/**
 * GET /fetch/segment/resource
 * - The player will request this route whenever it sees
 *   a line in the M3U8 like "/fetch/segment/resource?resourceId=xx&sig=yyy&exp=zzz"
 */
router.get("/segment/resource", async (req: Request, res: Response) => {
  const { resourceId, sig, exp } = req.query;

  if (!resourceId || !sig || !exp) {
    return res.status(400).json({ error: "Missing signed URL params" });
  }

  if (
    !verifySignedUrl(
      resourceId as string,
      sig as string,
      exp as string,
      "segment"
    )
  ) {
    return res.status(400).json({ error: "Invalid or expired signed URL" });
  }

  const cached = cache.get<{ url: string; ref?: string }>(
    resourceId as string
  );
  if (!cached || !cached.url) {
    return res.status(404).json({ error: "Resource not found or expired" });
  }

  try {
    const realUrl = cached.url;
    debug(`Fetching actual resource from: ${realUrl}`);

    const headers = buildHeaders(cached.ref);

    const segmentResp = await axios.get(realUrl, {
      responseType: "arraybuffer",
      headers,
      validateStatus: () => true,
    });

    if (segmentResp.status < 200 || segmentResp.status >= 300) {
      debug(
        `Upstream segment error. status=${
          segmentResp.status
        } url=${realUrl} data=${String(segmentResp.data).slice(0, 200)}`
      );
      res.status(segmentResp.status);
      return res.send(
        segmentResp.data ?? "Upstream error fetching segment"
      );
    }

    let contentType = segmentResp.headers["content-type"];
    if (!contentType) {
      contentType = "application/octet-stream";
    }

    res.setHeader("Content-Type", contentType);
    res.send(segmentResp.data);
    debug("Segment served successfully");
  } catch (error) {
    let status = 500;
    let msg = "Error fetching segment content";
    if ((error as AxiosError).isAxiosError) {
      const ae = error as AxiosError;
      status = ae.response?.status || 500;
      msg = ae.response?.data
        ? `Remote ${status}: ${String(
            ae.response?.statusText || ae.response?.data
          ).slice(0, 200)}`
        : ae.message;
      debug(
        `Failed to fetch resource. AxiosError status=${status} message=${
          ae.message
        } responseData=${String(ae.response?.data).slice(0, 200)}`
      );
    } else {
      debug(`Failed to fetch resource: ${(error as Error).message}`);
    }
    res.status(status).json({ error: msg });
  }
});

/**
 * GET /fetch/image
 * - Proxy for images with optional ref header
 */
router.get("/image", async (req: Request, res: Response) => {
  const { url, ref } = req.query;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "No URL provided" });
  }

  try {
    debug(`Fetching image from: ${url}`);

    const headers = buildHeaders(
      typeof ref === "string" ? ref : undefined
    );

    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) {
      debug(
        `Upstream image error. status=${response.status} url=${url} data=${String(
          response.data
        ).slice(0, 200)}`
      );
      res.status(response.status);
      return res.send(response.data ?? "Upstream error fetching image");
    }

    const contentType =
      response.headers["content-type"] || "application/octet-stream";
    res.setHeader("Content-Type", contentType);
    res.send(response.data);
    debug("Image served successfully");
  } catch (error) {
    let status = 500;
    let msg = "Error fetching image content";
    if ((error as AxiosError).isAxiosError) {
      const ae = error as AxiosError;
      status = ae.response?.status || 500;
      msg = ae.response?.data
        ? `Remote ${status}: ${String(
            ae.response?.statusText || ae.response?.data
          ).slice(0, 200)}`
        : ae.message;
      debug(
        `Failed to fetch image. AxiosError status=${status} message=${
          ae.message
        } responseData=${String(ae.response?.data).slice(0, 200)}`
      );
    } else {
      debug(`Failed to fetch image: ${(error as Error).message}`);
    }
    res.status(status).json({ error: msg });
  }
});

export default router;
