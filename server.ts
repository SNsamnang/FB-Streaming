import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import { fileURLToPath } from "url";
import ytdlpDefault from "yt-dlp-exec";

const ytdlpExec = (ytdlpDefault as any).exec as typeof import("yt-dlp-exec").exec;

import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Persistent storage location. Defaults to a "data" folder next to the
// project so uploaded/downloaded videos survive server restarts and reboots
// (many Linux distros mount /tmp as tmpfs or periodically clean it, which
// would otherwise silently delete everything). Override with DATA_DIR to
// point at a separate disk/volume.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const CHUNKS_DIR = path.join(DATA_DIR, "chunks");
const DOWNLOADS_DIR = path.join(DATA_DIR, "downloads");
const THUMBS_DIR = path.join(DATA_DIR, "thumbs");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(CHUNKS_DIR)) {
  fs.mkdirSync(CHUNKS_DIR, { recursive: true });
}
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(THUMBS_DIR)) {
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
}

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".webm",
  ".mov",
  ".ts",
  ".m4v",
  ".avi",
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
});

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // Basic CORS to allow frontend (e.g. Vercel) to call this API
  const allowedOrigin = process.env.CORS_ORIGIN || "*";
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", allowedOrigin);
    res.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With",
    );

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });

  // Increase limits for large video uploads
  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ limit: "500mb", extended: true }));

  // Serve uploaded files statically
  app.use("/api/uploads", express.static(UPLOADS_DIR));

  // Store active stream processes and status
  type StreamState = {
    processes: any[];
    status: "starting" | "live" | "error" | "stopped";
    errorMessage?: string;
  };

  const activeStreams = new Map<string, StreamState>();

  // API Routes
  app.get("/api/ping", (req, res) => {
    res.json({ status: "pong", timestamp: new Date().toISOString() });
  });

  app.post("/api/upload", (req, res) => {
    console.log("Upload request received");
    upload.single("video")(req, res, (err) => {
      if (err) {
        console.error("Multer/Upload Error:", err);
        return res.status(500).json({
          error: "Upload Error",
          details: err.message,
          code: (err as any).code,
        });
      }

      if (!req.file) {
        console.error("No file in request");
        return res.status(400).json({ error: "No file uploaded" });
      }

      console.log("File received:", req.file.filename, "Size:", req.file.size);

      // Try to get duration, but don't fail if ffprobe fails
      ffmpeg.ffprobe(req.file.path, (probeErr, metadata) => {
        const duration = metadata?.format?.duration || 0;
        if (probeErr) {
          console.warn("FFprobe failed, but continuing:", probeErr.message);
        }

        res.json({
          filename: req.file!.filename,
          path: req.file!.path,
          duration: duration,
        });
      });
    });
  });

  // Chunked Upload Endpoints
  app.post("/api/upload/chunk", upload.single("chunk"), (req, res) => {
    const { uploadId, chunkIndex } = req.body;
    if (!req.file || !uploadId || chunkIndex === undefined) {
      return res.status(400).json({ error: "Missing chunk data" });
    }

    const chunkDir = path.join(CHUNKS_DIR, uploadId);
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    const chunkPath = path.join(chunkDir, `chunk-${chunkIndex}`);
    fs.renameSync(req.file.path, chunkPath);

    res.json({ success: true });
  });

  app.post("/api/upload/finalize", async (req, res) => {
    const { uploadId, filename, totalChunks } = req.body;
    if (!uploadId || !filename || !totalChunks) {
      return res.status(400).json({ error: "Missing finalization data" });
    }

    const chunkDir = path.join(CHUNKS_DIR, uploadId);
    const finalPath = path.join(UPLOADS_DIR, filename);
    const writeStream = fs.createWriteStream(finalPath);
    let hasErrored = false;

    writeStream.on("error", (err) => {
      hasErrored = true;
      console.error("Finalization stream error:", err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "Failed to finalize upload", details: err.message });
      }
      // Best-effort cleanup of partially written file
      try {
        if (fs.existsSync(finalPath)) {
          fs.unlinkSync(finalPath);
        }
      } catch {
        // ignore cleanup errors
      }
    });

    try {
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(chunkDir, `chunk-${i}`);
        if (!fs.existsSync(chunkPath)) {
          throw new Error(`Chunk ${i} missing`);
        }

        if (hasErrored) {
          break;
        }

        const chunkBuffer = fs.readFileSync(chunkPath);

        // Write each chunk sequentially and wait for the write callback
        await new Promise<void>((resolve, reject) => {
          if (hasErrored) {
            return resolve();
          }
          writeStream.write(chunkBuffer, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        // Delete chunk after it has been successfully written
        fs.unlinkSync(chunkPath);
      }

      if (!hasErrored) {
        writeStream.end();

        writeStream.on("finish", () => {
          try {
            if (fs.existsSync(chunkDir)) {
              fs.rmdirSync(chunkDir);
            }
          } catch (cleanupErr) {
            console.warn("Failed to remove chunk directory:", cleanupErr);
          }

          // Get duration after reassembly
          ffmpeg.ffprobe(finalPath, (err, metadata) => {
            const duration = metadata?.format?.duration || 0;
            if (!res.headersSent) {
              res.json({
                filename: filename,
                path: finalPath,
                duration: duration,
              });
            }
          });
        });
      }
    } catch (err: any) {
      console.error("Finalization error:", err);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ error: "Failed to finalize upload", details: err.message });
      }
    }
  });

  // Video download endpoint. Uses yt-dlp under the hood, which supports
  // Facebook video/live URLs (public videos and videos you are authorized
  // to access) in addition to many other direct/streaming sources.
  type DownloadJob = {
    status: "processing" | "done" | "error" | "stopped";
    progress: number;
    filename: string | null;
    error: string | null;
    process: { kill: (signal?: string) => void } | null;
  };

  const downloadJobs = new Map<string, DownloadJob>();

  const isPrivateHost = (hostname: string) => {
    const host = hostname.toLowerCase();
    if (host === "localhost" || host === "::1") return true;
    if (/^127\./.test(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
    if (host === "169.254.169.254") return true;
    if (/^169\.254\./.test(host)) return true;
    return false;
  };

  const formatForQuality = (quality?: string) => {
    switch (quality) {
      case "medium":
        return "bestvideo*[height<=720]+bestaudio/best[height<=720]/best";
      case "low":
        return "bestvideo*[height<=480]+bestaudio/best[height<=480]/best";
      case "best":
      default:
        return "bestvideo*+bestaudio/best";
    }
  };

  const metaPathFor = (baseName: string) =>
    path.join(DOWNLOADS_DIR, `${baseName}.meta.json`);

  app.post("/api/download", async (req, res) => {
    const { url, quality } = req.body as {
      url?: string;
      quality?: string;
    };

    if (!url) {
      return res.status(400).json({ error: "Missing video URL" });
    }

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: "Invalid video URL" });
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return res.status(400).json({ error: "Only http(s) URLs are supported" });
    }

    if (isPrivateHost(parsed.hostname)) {
      return res.status(400).json({ error: "This host cannot be downloaded from" });
    }

    const downloadId =
      Date.now().toString() + "-" + Math.random().toString(36).slice(2);
    const outputTemplate = path.join(DOWNLOADS_DIR, `${downloadId}.%(ext)s`);

    // Best-effort metadata probe so the library can show a readable caption.
    let title = url;
    try {
      const info: any = await ytdlpDefault(url, {
        dumpSingleJson: true,
        simulate: true,
        noWarnings: true,
        noPlaylist: true,
        noCheckCertificate: true,
      });
      if (info && typeof info.title === "string" && info.title.trim()) {
        title = info.title.trim();
      }
    } catch (err: any) {
      console.warn(`[download ${downloadId}] metadata probe failed:`, err.message);
    }

    try {
      fs.writeFileSync(
        metaPathFor(downloadId),
        JSON.stringify({ title, sourceUrl: url, downloadedAt: Date.now() }),
      );
    } catch (err) {
      console.warn(`[download ${downloadId}] failed to write metadata`, err);
    }

    const job: DownloadJob = {
      status: "processing",
      progress: 0,
      filename: null,
      error: null,
      process: null,
    };
    downloadJobs.set(downloadId, job);

    const child = ytdlpExec(url, {
      output: outputTemplate,
      format: formatForQuality(quality),
      mergeOutputFormat: "mp4",
      noPlaylist: true,
      noWarnings: true,
      newline: true,
      noCheckCertificate: true,
      restrictFilenames: true,
    });

    job.process = child;

    let lastStderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(/(\d{1,3}(?:\.\d)?)%/);
      if (match) {
        const pct = Math.min(99, Math.max(0, parseFloat(match[1])));
        job.progress = pct;
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      lastStderr = text.trim() || lastStderr;
      console.error(`[download ${downloadId}]`, text.trim());
    });

    child
      .then(() => {
        if (job.status === "stopped") return;
        const found = fs
          .readdirSync(DOWNLOADS_DIR)
          .find((f) => f.startsWith(`${downloadId}.`) && !f.endsWith(".json"));
        if (!found) {
          job.status = "error";
          job.error = "Download finished but the output file was not found.";
          return;
        }
        job.filename = found;
        job.progress = 100;
        job.status = "done";
      })
      .catch((err: any) => {
        if (job.status === "stopped") return;
        job.status = "error";
        job.error =
          lastStderr.split("\n").pop() || err.message || "Download failed";
      });

    res.json({ downloadId });
  });

  app.get("/api/download/status/:downloadId", (req, res) => {
    const job = downloadJobs.get(req.params.downloadId);
    if (!job) {
      return res.status(404).json({ error: "Download not found" });
    }

    res.json({
      status: job.status,
      progress: job.progress,
      filename: job.filename,
      error: job.error,
    });
  });

  app.post("/api/download/stop/:downloadId", (req, res) => {
    const job = downloadJobs.get(req.params.downloadId);
    if (!job) {
      return res.status(404).json({ error: "Download not found" });
    }
    job.process?.kill("SIGTERM");
    job.status = "stopped";
    res.json({ status: "stopped" });
  });

  app.get("/api/downloads/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(DOWNLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }
    res.download(filePath, filename);
  });

  const probeDuration = (filePath: string): Promise<number> =>
    new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        resolve(err ? 0 : metadata?.format?.duration || 0);
      });
    });

  const readMeta = (baseName: string): { title?: string; downloadedAt?: number } => {
    try {
      const raw = fs.readFileSync(metaPathFor(baseName), "utf-8");
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };

  // List previously downloaded videos: used both to pick a streaming source
  // directly from the server, and to power the downloads library (with
  // thumbnail/caption/duration/date) on the Downloader page.
  app.get("/api/downloads", async (req, res) => {
    const filenames = fs
      .readdirSync(DOWNLOADS_DIR)
      .filter(
        (f) =>
          !f.startsWith(".") &&
          VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()),
      );

    const entries = await Promise.all(
      filenames.map(async (filename) => {
        const filePath = path.join(DOWNLOADS_DIR, filename);
        const stat = fs.statSync(filePath);
        const baseName = path.parse(filename).name;
        const meta = readMeta(baseName);
        const duration = await probeDuration(filePath);
        return {
          filename,
          size: stat.size,
          mtime: meta.downloadedAt ?? stat.mtimeMs,
          duration,
          title: meta.title || filename,
          thumbnailUrl: `/api/downloads/${encodeURIComponent(filename)}/thumbnail`,
        };
      }),
    );

    entries.sort((a, b) => b.mtime - a.mtime);
    res.json(entries);
  });

  app.get("/api/downloads/:filename/thumbnail", (req, res) => {
    const filename = path.basename(req.params.filename);
    const videoPath = path.join(DOWNLOADS_DIR, filename);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).end();
    }

    const thumbName = `${filename}.jpg`;
    const thumbPath = path.join(THUMBS_DIR, thumbName);

    if (fs.existsSync(thumbPath)) {
      return res.sendFile(thumbPath);
    }

    ffmpeg(videoPath)
      .on("end", () => res.sendFile(thumbPath))
      .on("error", (err) => {
        console.warn(`Thumbnail generation failed for ${filename}:`, err.message);
        res.status(500).end();
      })
      .screenshots({
        timestamps: ["10%"],
        filename: thumbName,
        folder: THUMBS_DIR,
        size: "320x?",
      });
  });

  app.delete("/api/downloads/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(DOWNLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "File not found" });
    }

    fs.unlinkSync(filePath);

    const baseName = path.parse(filename).name;
    const metaPath = metaPathFor(baseName);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);

    const thumbPath = path.join(THUMBS_DIR, `${filename}.jpg`);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

    res.json({ status: "deleted" });
  });

  // Cut one or more time ranges out of a downloaded video and combine them
  // into a single new output file.
  type CutJob = {
    status: "processing" | "done" | "error";
    progress: number;
    filename: string | null;
    error: string | null;
  };
  const cutJobs = new Map<string, CutJob>();

  const sanitizeBaseName = (name: string) =>
    name
      .replace(/[^a-zA-Z0-9-_ ]/g, "")
      .trim()
      .slice(0, 60) || "clip";

  app.post("/api/downloads/cut", (req, res) => {
    const { filename, newName, segments } = req.body as {
      filename?: string;
      newName?: string;
      segments?: { start: number; end: number }[];
    };

    if (!filename || !Array.isArray(segments) || segments.length === 0) {
      return res.status(400).json({ error: "Missing filename or time ranges" });
    }

    for (const seg of segments) {
      if (
        typeof seg.start !== "number" ||
        typeof seg.end !== "number" ||
        !Number.isFinite(seg.start) ||
        !Number.isFinite(seg.end) ||
        seg.start < 0 ||
        seg.end <= seg.start
      ) {
        return res.status(400).json({ error: "Invalid time range" });
      }
    }

    const safeName = path.basename(filename);
    const sourcePath = path.join(DOWNLOADS_DIR, safeName);
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: "Source video not found" });
    }

    const cutId = Date.now().toString() + "-" + Math.random().toString(36).slice(2);
    const outputFilename = `${cutId}-${sanitizeBaseName(newName || "clip")}.mp4`;
    const outputPath = path.join(DOWNLOADS_DIR, outputFilename);

    const job: CutJob = {
      status: "processing",
      progress: 0,
      filename: null,
      error: null,
    };
    cutJobs.set(cutId, job);

    // Segments are weighted by their own duration so overall progress
    // reflects how much of the total requested footage has been encoded.
    // The remaining slice is reserved for the final concat step (when there
    // is more than one segment to stitch together).
    const totalDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
    const hasConcatStep = segments.length > 1;
    const encodeShare = hasConcatStep ? 90 : 99;
    let completedDuration = 0;

    // fluent-ffmpeg's own `progress.percent` is computed against the
    // *source* file's total duration, not the trimmed segment's duration
    // (setStartTime/setDuration don't change what ffmpeg reports as the
    // input's nominal length). For a short clip cut out of a long video
    // that makes percent stay near 0 the whole time, so we instead derive
    // elapsed time from `timemark` and divide by the segment's own length.
    const timemarkToSeconds = (timemark: string): number => {
      const parts = timemark.split(":").map(Number);
      if (parts.some((p) => Number.isNaN(p))) return 0;
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parts[0] || 0;
    };

    const runSegment = (start: number, end: number, outPath: string) =>
      new Promise<void>((resolve, reject) => {
        const segDuration = end - start;
        ffmpeg(sourcePath)
          .setStartTime(start)
          .setDuration(segDuration)
          .outputOptions([
            // Stream copy instead of re-encoding: near-instant cutting.
            // Start/end snap to the nearest keyframe, so boundaries can be
            // off by a second or two from the exact requested time.
            "-c copy",
            "-avoid_negative_ts make_zero",
          ])
          .output(outPath)
          .on("progress", (progress) => {
            const elapsed = timemarkToSeconds(progress.timemark || "0:00:00");
            const segPercent = Math.min(100, Math.max(0, (elapsed / segDuration) * 100));
            const segProgressDuration = (segPercent / 100) * segDuration;
            const overall =
              ((completedDuration + segProgressDuration) / totalDuration) *
              encodeShare;
            job.progress = Math.min(encodeShare, Math.max(0, overall));
          })
          .on("end", () => {
            completedDuration += segDuration;
            job.progress = Math.min(
              encodeShare,
              (completedDuration / totalDuration) * encodeShare,
            );
            resolve();
          })
          .on("error", (err) => reject(err))
          .run();
      });

    const runConcat = (listPath: string, outPath: string) =>
      new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(listPath)
          .inputOptions(["-f concat", "-safe 0"])
          .outputOptions(["-c copy"])
          .output(outPath)
          .on("end", () => resolve())
          .on("error", (err) => reject(err))
          .run();
      });

    (async () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cut-"));
      try {
        const segmentPaths: string[] = [];
        for (let i = 0; i < segments.length; i++) {
          const segPath = path.join(tempDir, `seg-${i}.mp4`);
          await runSegment(segments[i].start, segments[i].end, segPath);
          segmentPaths.push(segPath);
        }

        if (segmentPaths.length === 1) {
          fs.copyFileSync(segmentPaths[0], outputPath);
        } else {
          job.progress = encodeShare;
          const listPath = path.join(tempDir, "list.txt");
          const listContent = segmentPaths
            .map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
            .join("\n");
          fs.writeFileSync(listPath, listContent);
          await runConcat(listPath, outputPath);
        }

        fs.writeFileSync(
          metaPathFor(path.parse(outputFilename).name),
          JSON.stringify({
            title: newName?.trim() || "Clip",
            downloadedAt: Date.now(),
          }),
        );

        job.progress = 100;
        job.filename = outputFilename;
        job.status = "done";
      } catch (err: any) {
        console.error(`Cut job ${cutId} failed:`, err.message || err);
        job.status = "error";
        job.error = err.message || "Failed to cut video";
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    })();

    res.json({ cutId, filename: outputFilename });
  });

  app.get("/api/downloads/cut/status/:cutId", (req, res) => {
    const job = cutJobs.get(req.params.cutId);
    if (!job) {
      return res.status(404).json({ error: "Cut job not found" });
    }
    res.json(job);
  });

  // Use a previously downloaded video as a streaming source: copy it into
  // the uploads directory (if not already there) and report its duration,
  // so it can be treated exactly like an uploaded file from then on.
  app.post("/api/downloads/use", (req, res) => {
    const { filename } = req.body as { filename?: string };
    if (!filename) {
      return res.status(400).json({ error: "Missing filename" });
    }

    const safeName = path.basename(filename);
    const sourcePath = path.join(DOWNLOADS_DIR, safeName);
    if (!fs.existsSync(sourcePath)) {
      return res.status(404).json({ error: "Downloaded file not found" });
    }

    const destPath = path.join(UPLOADS_DIR, safeName);
    try {
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(sourcePath, destPath);
      }
    } catch (err: any) {
      return res.status(500).json({
        error: "Failed to prepare downloaded video for streaming",
        details: err.message,
      });
    }

    ffmpeg.ffprobe(destPath, (probeErr, metadata) => {
      const duration = metadata?.format?.duration || 0;
      if (probeErr) {
        console.warn("FFprobe failed, but continuing:", probeErr.message);
      }
      res.json({
        filename: safeName,
        path: destPath,
        duration,
      });
    });
  });

  app.post("/api/stream/start", (req, res) => {
    const { filename, streamKeys, loop, loopTimes } = req.body as {
      filename?: string;
      streamKeys?: string[];
      loop?: boolean;
      loopTimes?: number | null;
    };
    if (!filename || !streamKeys || !Array.isArray(streamKeys)) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const videoPath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: "Video file not found" });
    }

    const streamId = Date.now().toString();
    const processes: any[] = [];

    const shouldLoop = Boolean(loop);
    const numericLoopTimes =
      typeof loopTimes === "number" && Number.isFinite(loopTimes)
        ? Math.max(1, Math.round(loopTimes))
        : null;

    let finishedCount = 0;

    streamKeys.forEach((key, index) => {
      const rtmpUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${key}`;
      const inputOptions = [
        "-re", // Read input at native frame rate
      ];

      if (shouldLoop) {
        if (numericLoopTimes) {
          // ffmpeg -stream_loop N: repeats input N additional times.
          // For total plays = numericLoopTimes, use N = total - 1.
          const ffmpegLoopCount = Math.max(0, numericLoopTimes - 1);
          inputOptions.push("-stream_loop", ffmpegLoopCount.toString());
        } else {
          // If no specific loop count provided, loop indefinitely.
          inputOptions.push("-stream_loop", "-1");
        }
      }

      const command = ffmpeg(videoPath)
        .inputOptions(inputOptions)
        .outputOptions([
          "-c:v libx264",
          "-preset veryfast",
          "-maxrate 3000k",
          "-bufsize 6000k",
          "-pix_fmt yuv420p",
          "-g 50",
          "-c:a aac",
          "-b:a 128k",
          "-ar 44100",
          "-f flv",
        ])
        .output(rtmpUrl)
        .on("start", (commandLine) => {
          console.log(`Spawned FFmpeg with command: ${commandLine}`);
          const state = activeStreams.get(streamId);
          if (state) {
            state.status = "live";
          }
        })
        .on("error", (err) => {
          console.error(`Error on stream ${index}: ${err.message}`);
          const state = activeStreams.get(streamId);
          if (state) {
            state.status = "error";
            state.errorMessage = err.message;
          }
        })
        .on("end", () => {
          console.log(`Stream ${index} finished`);
          const state = activeStreams.get(streamId);
          if (state && state.status !== "error") {
            finishedCount += 1;
            if (finishedCount >= streamKeys.length) {
              state.status = "stopped";
            }
          }
        });

      command.run();
      processes.push(command);
    });

    activeStreams.set(streamId, { processes, status: "starting" });

    res.json({ streamId, status: "started" });
  });

  app.post("/api/stream/stop", (req, res) => {
    const { streamId } = req.body;
    const state = activeStreams.get(streamId);
    const processes = state?.processes;
    if (processes && processes.length > 0) {
      processes.forEach((p) => p.kill("SIGKILL"));
      activeStreams.delete(streamId);
      res.json({ status: "stopped" });
    } else {
      res.status(404).json({ error: "Stream not found" });
    }
  });

  app.get("/api/stream/status/:streamId", (req, res) => {
    const { streamId } = req.params;
    const state = activeStreams.get(streamId);
    if (!state) {
      return res.status(404).json({ status: "not-found" });
    }

    res.json({
      status: state.status,
      error: state.errorMessage ?? null,
    });
  });

  // Global error handler
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      console.error("Global error handler:", err);
      res.status(err.status || 500).json({
        error: err.message || "Internal Server Error",
      });
    },
  );

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
