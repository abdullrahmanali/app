// index.js (CommonJS) - مصحح وآمن للعمل على Replit / localhost
const express = require("express");
const path = require("path");
const axios = require("axios");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const app = express();
const PORT = process.env.PORT || 3002;

// serve static public (css/js/images if any)
app.use(express.static(path.join(__dirname, "public")));

// favicon route to avoid 404 noise
app.get("/favicon.ico", (req, res) => res.sendStatus(204));

// Serve main page: **pages/index.html** (هذا المهم — لا تغيره لـ public/index.html)
app.get("/", (req, res) => {
  const main = path.join(__dirname, "pages", "index.html");
  return res.sendFile(main);
});

// helper for base url (respect x-forwarded-proto)
function getBaseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  return `${proto}://${req.get("host")}`;
}

// =========================
// Image proxy (with UA, Referer and fallback to local placeholder)
// =========================
app.get("/api/image/:id.jpg", async (req, res) => {
  try {
    const id = encodeURIComponent(req.params.id);
    const remote = `https://app.sanime.net/api/anime/${id}/image.jpg`;

    // try stream first with browser-like headers
    const response = await axios.get(remote, {
      responseType: "stream",
      timeout: 12000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Referer: "https://app.sanime.net/",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    // pass content-type if present
    if (response.headers && response.headers["content-type"]) {
      res.set("Content-Type", response.headers["content-type"]);
    } else {
      res.set("Content-Type", "image/jpeg");
    }

    // stream to client
    response.data.pipe(res);
  } catch (err) {
    // Log detailed error for debugging
    console.error(
      "Image proxy error for id=",
      req.params.id,
      "->",
      (err && err.message) || err,
    );
    if (err.response && err.response.status) {
      console.error("Remote status:", err.response.status);
    }

    // send fallback placeholder to avoid broken icon
    const fallback = path.join(__dirname, "public", "img", "noimage.jpg");
    // if fallback exists send it, otherwise send 204
    try {
      return res.sendFile(fallback);
    } catch (e) {
      return res.sendStatus(204);
    }
  }
});

// =========================
// Search proxy (maps image links to our proxy)
// =========================
app.get("/api/search", async (req, res) => {
  try {
    const q = req.query.name || req.query.q || "";
    const apiUrl = `https://app.sanime.net/function/h10.php?page=search&name=${encodeURIComponent(q)}`;

    const response = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Node.js)",
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    const base = getBaseUrl(req);

    const data = Array.isArray(response.data)
      ? response.data.map((item) => ({
          ...item,
          image: `${base}/api/image/${item.id}.jpg`,
        }))
      : [];

    res.json(data);
  } catch (err) {
    console.error("/api/search error:", err.message || err);
    res.status(500).json({ error: "Failed to fetch search" });
  }
});

// =========================
// Info proxy (supports ?id= and /api/info/:id)
// =========================
app.get("/api/info", async (req, res) => {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: "missing id" });
  return proxyInfoById(id, req, res);
});
app.get("/api/info/:id", async (req, res) => {
  const id = req.params.id;
  return proxyInfoById(id, req, res);
});

async function proxyInfoById(id, req, res) {
  try {
    const apiUrl = `https://app.sanime.net/function/h10.php?page=info&id=${encodeURIComponent(id)}`;
    const response = await axios.get(apiUrl, {
      timeout: 10000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });

    let info = response.data;
    if (typeof info === "string") {
      try {
        info = JSON.parse(info);
      } catch (e) {
        /* leave as-is */
      }
    }
    if (!info || typeof info !== "object")
      return res.status(502).json({ error: "Invalid info response" });

    // map images to our proxy
    const base = getBaseUrl(req);
    const mapImage = (url, fallbackId) => {
      try {
        if (!url) return `${base}/api/image/${fallbackId}.jpg`;
        const u = new URL(url);
        const parts = u.pathname.split("/");
        const idx = parts.indexOf("anime");
        const maybeId =
          idx !== -1 && parts[idx + 1] ? parts[idx + 1] : fallbackId;
        return `${base}/api/image/${maybeId}.jpg`;
      } catch (e) {
        return `${base}/api/image/${fallbackId}.jpg`;
      }
    };

    if (info.tag) info.tag = mapImage(info.tag, info.id);
    if (info.cover) info.cover = mapImage(info.cover, info.id);
    if (info.background) info.background = mapImage(info.background, info.id);
    if (Array.isArray(info.other)) {
      info.other = info.other.map((o) => ({
        ...o,
        image: o.image
          ? mapImage(o.image, o.id || info.id)
          : `${base}/api/image/${o.id || info.id}.jpg`,
      }));
    }

    res.json(info);
  } catch (err) {
    console.error("/api/info error:", err.message || err);
    res.status(500).json({ error: "Failed to fetch info" });
  }
}

// =========================
// Video proxy (Range support) - كما في كودك الأصلي
// =========================
function libFor(urlObj) {
  return urlObj.protocol === "https:" ? https : http;
}

function probeGetRange(remoteUrl, timeout = 6000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(remoteUrl);
      const lib = libFor(u);
      const opts = {
        method: "GET",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + (u.search || ""),
        headers: { Range: "bytes=0-0" },
        timeout,
      };
      const req = lib.request(opts, (res) => {
        const ok =
          res.statusCode &&
          (res.statusCode === 206 ||
            (res.statusCode >= 200 && res.statusCode < 400));
        resolve({ ok, statusCode: res.statusCode, headers: res.headers });
        req.abort();
      });
      req.on("error", (e) => reject(e));
      req.on("timeout", () => {
        req.abort();
        reject(new Error("GET range timeout"));
      });
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

function probeUrl(remoteUrl, timeout = 6000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(remoteUrl);
      const lib = libFor(u);
      const headOpts = {
        method: "HEAD",
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + (u.search || ""),
        timeout,
      };
      const headReq = lib.request(headOpts, (res) => {
        const ok =
          res.statusCode && res.statusCode >= 200 && res.statusCode < 400;
        resolve({ ok, statusCode: res.statusCode, headers: res.headers });
        headReq.abort();
      });
      headReq.on("error", async () => {
        try {
          const getOk = await probeGetRange(remoteUrl, timeout);
          resolve(getOk);
        } catch (e) {
          resolve({ ok: false, error: e.message || e });
        }
      });
      headReq.on("timeout", async () => {
        headReq.abort();
        try {
          const getOk = await probeGetRange(remoteUrl, timeout);
          resolve(getOk);
        } catch (e) {
          resolve({ ok: false, error: e.message || e });
        }
      });
      headReq.end();
    } catch (e) {
      probeGetRange(remoteUrl, timeout)
        .then((r) => resolve(r))
        .catch((err) => resolve({ ok: false, error: err.message || err }));
    }
  });
}

function streamRemote(remoteUrl, rangeHeader, clientReq, clientRes) {
  const u = new URL(remoteUrl);
  const lib = libFor(u);
  const headers = {};
  if (rangeHeader) headers.Range = rangeHeader;

  const opts = {
    method: "GET",
    hostname: u.hostname,
    port: u.port || (u.protocol === "https:" ? 443 : 80),
    path: u.pathname + (u.search || ""),
    headers,
  };

  const remoteReq = lib.request(opts, (remoteRes) => {
    const statusCode =
      remoteRes.statusCode === 200 && rangeHeader ? 206 : remoteRes.statusCode;
    const resHeaders = {
      "Content-Type": remoteRes.headers["content-type"] || "video/mp4",
      "Accept-Ranges": remoteRes.headers["accept-ranges"] || "bytes",
    };
    if (remoteRes.headers["content-length"])
      resHeaders["Content-Length"] = remoteRes.headers["content-length"];
    if (remoteRes.headers["content-range"])
      resHeaders["Content-Range"] = remoteRes.headers["content-range"];

    clientRes.writeHead(statusCode, resHeaders);
    remoteRes.pipe(clientRes);
  });

  remoteReq.on("error", (err) => {
    console.error("Remote stream error:", err.message || err);
    if (!clientRes.headersSent) clientRes.sendStatus(502);
    else clientRes.end();
  });

  clientReq.on("close", () => {
    try {
      remoteReq.abort();
    } catch (e) {}
  });

  remoteReq.end();
}

app.get("/stream/:id/:ep", async (req, res) => {
  try {
    const id = req.params.id;
    const ep = req.params.ep;
    if (!id || !ep) return res.status(400).send("missing id or ep");

    const candidates = [
      `https://server.sanime.net/Video/${encodeURIComponent(id)}/${encodeURIComponent(ep)}.mp4`,
      `https://server.sanime.net/Video2/${encodeURIComponent(id)}/${encodeURIComponent(ep)}.mp4`,
    ];

    const TEST_REMOTE = "https://server.sanime.net/Video/11649/1.mp4";
    const useTest =
      process.env.USE_TEST_VIDEO === "1" || req.query.test === "1";
    if (useTest) {
      try {
        await probeUrl(TEST_REMOTE);
      } catch (e) {}
      return streamRemote(TEST_REMOTE, req.headers.range || null, req, res);
    }

    let chosen = null;
    for (const c of candidates) {
      try {
        const p = await probeUrl(c, 5000);
        if (p && p.ok) {
          chosen = c;
          break;
        }
      } catch (e) {
        /* try next */
      }
    }

    if (!chosen) {
      console.error("No candidate video available for", id, ep);
      return res.status(502).send("Remote video not available");
    }

    streamRemote(chosen, req.headers.range || null, req, res);
  } catch (err) {
    console.error("/stream error:", err.message || err);
    res.sendStatus(500);
  }
});

// start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
