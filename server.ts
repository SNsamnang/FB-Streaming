import express from "express";
import { createServer as createViteServer } from "vite";
import multer from "multer";
import path from "path";
import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import { fileURLToPath } from "url";

import os from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use /tmp for uploads as it's more likely to be writable in restricted environments
const UPLOADS_DIR = path.join(os.tmpdir(), "multi-stream-uploads");
const CHUNKS_DIR = path.join(os.tmpdir(), "multi-stream-chunks");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
if (!fs.existsSync(CHUNKS_DIR)) {
  fs.mkdirSync(CHUNKS_DIR, { recursive: true });
}

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
  const PORT = 3000;

  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  // Increase limits for large video uploads
  app.use(express.json({ limit: "500mb" }));
  app.use(express.urlencoded({ limit: "500mb", extended: true }));

  // Serve uploaded files statically
  app.use("/api/uploads", express.static(UPLOADS_DIR));

  // Store active stream processes
  const activeStreams = new Map<string, any[]>();

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

  app.post("/api/stream/start", (req, res) => {
    const { filename, streamKeys } = req.body;
    if (!filename || !streamKeys || !Array.isArray(streamKeys)) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const videoPath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: "Video file not found" });
    }

    const streamId = Date.now().toString();
    const processes: any[] = [];

    streamKeys.forEach((key, index) => {
      const rtmpUrl = `rtmps://live-api-s.facebook.com:443/rtmp/${key}`;

      const command = ffmpeg(videoPath)
        .inputOptions([
          "-re", // Read input at native frame rate
        ])
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
        })
        .on("error", (err) => {
          console.error(`Error on stream ${index}: ${err.message}`);
        })
        .on("end", () => {
          console.log(`Stream ${index} finished`);
        });

      command.run();
      processes.push(command);
    });

    activeStreams.set(streamId, processes);

    res.json({ streamId, status: "started" });
  });

  app.post("/api/stream/stop", (req, res) => {
    const { streamId } = req.body;
    const processes = activeStreams.get(streamId);
    if (processes) {
      processes.forEach((p) => p.kill("SIGKILL"));
      activeStreams.delete(streamId);
      res.json({ status: "stopped" });
    } else {
      res.status(404).json({ error: "Stream not found" });
    }
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
