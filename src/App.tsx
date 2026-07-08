import React, { useState, useRef, useEffect } from "react";
import {
  Upload,
  Plus,
  Trash2,
  Play,
  Square,
  CheckCircle2,
  AlertCircle,
  Video,
  Settings,
  Activity,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type ServerFile = {
  filename: string;
  path: string;
  duration: number;
};

type ServerVideoEntry = {
  filename: string;
  size: number;
  mtime: number;
  duration: number;
  title: string;
  thumbnailUrl: string;
};

type StreamSession = {
  id: string;
  name: string;
  file: File | null;
  streamKeys: string[];
  isUploading: boolean;
  uploadProgress: number;
  serverFile: ServerFile | null;
  isStreaming: boolean;
  streamId: string | null;
  error: string | null;
  currentTimeSeconds: number;
  status: "IDLE" | "LIVE" | "FINISHED";
  loop: boolean;
  streamStartTime: number | null;
  streamElapsedSeconds: number;
  streamLoopCount: number;
  loopDurationSeconds: number | null;
};

function createEmptySession(index: number): StreamSession {
  return {
    id: `${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
    name: `Stream ${index}`,
    file: null,
    streamKeys: [""],
    isUploading: false,
    uploadProgress: 0,
    serverFile: null,
    isStreaming: false,
    streamId: null,
    error: null,
    currentTimeSeconds: 0,
    status: "IDLE",
    loop: false,
    streamStartTime: null,
    streamElapsedSeconds: 0,
    streamLoopCount: 0,
    loopDurationSeconds: null,
  };
}

export default function App() {
  const ADMIN_EMAIL = "admin@gmail.com";
  const ADMIN_PASSWORD = "Pa$$w0rd";

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<StreamSession[]>([
    createEmptySession(1),
  ]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<"stream" | "download">("stream");

  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloadQuality, setDownloadQuality] = useState<
    "best" | "medium" | "low"
  >("best");
  const [downloadStatus, setDownloadStatus] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadFileUrl, setDownloadFileUrl] = useState<string | null>(null);

  const [videoSourceMode, setVideoSourceMode] = useState<"device" | "server">(
    "device",
  );
  const [serverVideos, setServerVideos] = useState<ServerVideoEntry[]>([]);
  const [isLoadingServerVideos, setIsLoadingServerVideos] = useState(false);
  const [serverVideosError, setServerVideosError] = useState<string | null>(
    null,
  );
  const [selectingServerVideo, setSelectingServerVideo] = useState<
    string | null
  >(null);
  const [deletingServerVideo, setDeletingServerVideo] = useState<
    string | null
  >(null);

  const [cutTargetFilename, setCutTargetFilename] = useState<string | null>(
    null,
  );
  const [cutNewName, setCutNewName] = useState("");
  const [cutRanges, setCutRanges] = useState<
    { start: string; end: string }[]
  >([{ start: "", end: "" }]);
  const [isCutting, setIsCutting] = useState(false);
  const [cutJobId, setCutJobId] = useState<string | null>(null);
  const [cutProgress, setCutProgress] = useState(0);
  const [cutError, setCutError] = useState<string | null>(null);
  const [cutStatusMessage, setCutStatusMessage] = useState<string | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load saved admin session & dashboard state on first mount
  useEffect(() => {
    try {
      const storedAuth = window.localStorage.getItem("admin-authenticated");
      if (storedAuth === "true") {
        setIsAuthenticated(true);
      }

      const storedState = window.localStorage.getItem("admin-dashboard");
      if (storedState) {
        const parsed = JSON.parse(storedState) as {
          sessions: Array<{
            id?: string;
            name?: string;
            streamKeys?: string[];
            serverFile?: ServerFile | null;
            isStreaming?: boolean;
            streamId?: string | null;
            currentTimeSeconds?: number;
            status?: "IDLE" | "LIVE" | "FINISHED";
            loop?: boolean;
            streamStartTime?: number | null;
            streamElapsedSeconds?: number;
            streamLoopCount?: number;
            loopDurationSeconds?: number | null;
          }>;
          activeIndex?: number;
        };

        if (Array.isArray(parsed.sessions) && parsed.sessions.length > 0) {
          const hydrated: StreamSession[] = parsed.sessions.map((s, i) => ({
            file: null,
            // Fallback name/id if missing
            id:
              s.id ||
              `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
            name: s.name || `Stream ${i + 1}`,
            streamKeys:
              s.streamKeys && s.streamKeys.length > 0 ? s.streamKeys : [""],
            isUploading: false,
            uploadProgress: 0,
            serverFile: s.serverFile ?? null,
            isStreaming: s.isStreaming ?? false,
            streamId: s.streamId ?? null,
            error: null,
            currentTimeSeconds: s.currentTimeSeconds ?? 0,
            status: s.status ?? (s.isStreaming ? "LIVE" : "IDLE"),
            loop: s.loop ?? false,
            streamStartTime: s.streamStartTime ?? null,
            streamElapsedSeconds: s.streamElapsedSeconds ?? 0,
            streamLoopCount: s.streamLoopCount ?? 0,
            loopDurationSeconds: s.loopDurationSeconds ?? null,
          }));

          setSessions(hydrated);

          const idx =
            typeof parsed.activeIndex === "number" &&
            parsed.activeIndex >= 0 &&
            parsed.activeIndex < hydrated.length
              ? parsed.activeIndex
              : 0;
          setActiveIndex(idx);
        }
      }
    } catch (e) {
      console.warn("Failed to restore admin dashboard state", e);
    }
  }, []);

  // Persist dashboard state for admin user whenever it changes
  useEffect(() => {
    if (!isAuthenticated) return;
    try {
      const toSave = {
        sessions: sessions.map((s) => ({
          id: s.id,
          name: s.name,
          streamKeys: s.streamKeys,
          serverFile: s.serverFile,
          isStreaming: s.isStreaming,
          streamId: s.streamId,
          currentTimeSeconds: s.currentTimeSeconds,
          status: s.status,
          loop: s.loop,
          streamStartTime: s.streamStartTime,
          streamElapsedSeconds: s.streamElapsedSeconds,
          streamLoopCount: s.streamLoopCount,
          loopDurationSeconds: s.loopDurationSeconds,
        })),
        activeIndex,
      };
      window.localStorage.setItem("admin-dashboard", JSON.stringify(toSave));
      window.localStorage.setItem("admin-authenticated", "true");
    } catch (e) {
      console.warn("Failed to persist admin dashboard state", e);
    }
  }, [sessions, activeIndex, isAuthenticated]);

  const testConnection = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ping`);
      const data = await res.json();
      setConnectionStatus(`Connected: ${data.timestamp}`);
      setTimeout(() => setConnectionStatus(null), 3000);
    } catch (err) {
      setConnectionStatus("Connection Failed");
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
      setAuthError(null);
      window.localStorage.setItem("admin-authenticated", "true");
    } else {
      setAuthError("Invalid email or password");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setEmail("");
    setPassword("");
    window.localStorage.removeItem("admin-authenticated");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const index = activeIndex;
      setSessions((prev) => {
        const next = [...prev];
        const session = {
          ...next[index],
          file,
          serverFile: null,
          error: null,
          currentTimeSeconds: 0,
        };
        next[index] = session;
        return next;
      });
    }
  };

  const fetchServerVideos = async () => {
    setIsLoadingServerVideos(true);
    setServerVideosError(null);
    try {
      const res = await fetch(`${API_BASE}/api/downloads`);
      if (!res.ok) throw new Error("Failed to load downloaded videos");
      const data = (await res.json()) as ServerVideoEntry[];
      setServerVideos(data);
    } catch (err: any) {
      setServerVideosError(err.message || "Failed to load downloaded videos");
    } finally {
      setIsLoadingServerVideos(false);
    }
  };

  useEffect(() => {
    if (videoSourceMode === "server" || activePage === "download") {
      fetchServerVideos();
    }
  }, [videoSourceMode, activePage]);

  const selectServerVideo = async (filename: string) => {
    const index = activeIndex;
    setSelectingServerVideo(filename);
    setSessions((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], error: null };
      return next;
    });

    try {
      const res = await fetch(`${API_BASE}/api/downloads/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (data && (data as any).error) || "Failed to use downloaded video",
        );
      }

      setSessions((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        next[index] = {
          ...next[index],
          file: null,
          serverFile: data as ServerFile,
          isUploading: false,
          uploadProgress: 0,
          currentTimeSeconds: 0,
        };
        return next;
      });
    } catch (err: any) {
      setSessions((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        next[index] = {
          ...next[index],
          error: err.message || "Failed to use downloaded video",
        };
        return next;
      });
    } finally {
      setSelectingServerVideo(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const deleteServerVideo = async (filename: string) => {
    if (!window.confirm(`Delete "${filename}" from the server? This cannot be undone.`)) {
      return;
    }
    setDeletingServerVideo(filename);
    try {
      const res = await fetch(
        `${API_BASE}/api/downloads/${encodeURIComponent(filename)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete video");
      setServerVideos((prev) => prev.filter((v) => v.filename !== filename));
      if (cutTargetFilename === filename) {
        setCutTargetFilename(null);
      }
    } catch (err: any) {
      setServerVideosError(err.message || "Failed to delete video");
    } finally {
      setDeletingServerVideo(null);
    }
  };

  const openCutPanel = (video: ServerVideoEntry) => {
    setCutTargetFilename(video.filename);
    setCutNewName(video.title.replace(/\.[^./]+$/, ""));
    setCutRanges([{ start: "", end: "" }]);
    setCutError(null);
    setCutStatusMessage(null);
    setCutProgress(0);
  };

  const closeCutPanel = () => {
    setCutTargetFilename(null);
    setCutRanges([{ start: "", end: "" }]);
    setCutError(null);
    setCutStatusMessage(null);
    setCutProgress(0);
  };

  const addCutRange = () => {
    setCutRanges((prev) => [...prev, { start: "", end: "" }]);
  };

  const removeCutRange = (index: number) => {
    setCutRanges((prev) => prev.filter((_, i) => i !== index));
  };

  const updateCutRange = (
    index: number,
    field: "start" | "end",
    value: string,
  ) => {
    setCutRanges((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const parseTimeToSeconds = (value: string): number | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(":").map((p) => p.trim());
    if (parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) {
      return null;
    }
    const nums = parts.map(Number);
    if (nums.length === 1) return nums[0];
    if (nums.length === 2) return nums[0] * 60 + nums[1];
    return nums[0] * 3600 + nums[1] * 60 + nums[2];
  };

  const handleCutSubmit = async () => {
    if (!cutTargetFilename) return;

    const segments: { start: number; end: number }[] = [];
    for (const range of cutRanges) {
      const start = parseTimeToSeconds(range.start);
      const end = parseTimeToSeconds(range.end);
      if (start === null || end === null) {
        setCutError("Please enter valid times as HH:MM:SS (or MM:SS).");
        return;
      }
      if (end <= start) {
        setCutError("Each range's end time must be after its start time.");
        return;
      }
      segments.push({ start, end });
    }

    if (segments.length === 0) {
      setCutError("Add at least one time range.");
      return;
    }

    setIsCutting(true);
    setCutError(null);
    setCutProgress(0);
    setCutStatusMessage("Cutting video... 0%");

    try {
      const res = await fetch(`${API_BASE}/api/downloads/cut`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: cutTargetFilename,
          newName: cutNewName.trim() || "Clip",
          segments,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && (data as any).error) || "Failed to cut video");
      }

      setCutJobId((data as any).cutId);
    } catch (err: any) {
      setCutError(err.message || "Failed to cut video");
      setCutStatusMessage(null);
      setIsCutting(false);
    }
  };

  useEffect(() => {
    if (!cutJobId) return;

    const interval = window.setInterval(() => {
      fetch(`${API_BASE}/api/downloads/cut/status/${cutJobId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: any) => {
          if (!data) return;

          if (data.status === "processing") {
            const pct = Math.round(data.progress ?? 0);
            setCutProgress(pct);
            setCutStatusMessage(`Cutting video... ${pct}%`);
            return;
          }

          if (data.status === "done") {
            setCutProgress(100);
            setCutStatusMessage("Clip ready in your downloads library.");
            setIsCutting(false);
            setCutJobId(null);
            fetchServerVideos();
            return;
          }

          if (data.status === "error") {
            setCutError(data.error || "Failed to cut video");
            setCutStatusMessage(null);
            setIsCutting(false);
            setCutJobId(null);
          }
        })
        .catch(() => {
          // Ignore transient polling errors; retry on next tick.
        });
    }, 1500);

    return () => window.clearInterval(interval);
  }, [cutJobId]);

  const formatDate = (mtime: number) => new Date(mtime).toLocaleString();

  const addStreamKey = () => {
    const index = activeIndex;
    setSessions((prev) => {
      const next = [...prev];
      const session = next[index];
      next[index] = {
        ...session,
        streamKeys: [...session.streamKeys, ""],
      };
      return next;
    });
  };

  const removeStreamKey = (keyIndex: number) => {
    const index = activeIndex;
    setSessions((prev) => {
      const next = [...prev];
      const session = next[index];
      const newKeys = [...session.streamKeys];
      newKeys.splice(keyIndex, 1);
      next[index] = {
        ...session,
        streamKeys: newKeys.length ? newKeys : [""],
      };
      return next;
    });
  };

  const updateStreamKey = (keyIndex: number, value: string) => {
    const index = activeIndex;
    setSessions((prev) => {
      const next = [...prev];
      const session = next[index];
      const newKeys = [...session.streamKeys];
      newKeys[keyIndex] = value;
      next[index] = {
        ...session,
        streamKeys: newKeys,
      };
      return next;
    });
  };

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s]
      .map((v) => (v < 10 ? "0" + v : v))
      .filter((v, i) => v !== "00" || i > 0)
      .join(":");
  };

  const uploadVideo = async () => {
    const index = activeIndex;
    const session = sessions[index];
    const file = session.file;
    if (!file) return;

    setSessions((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        isUploading: true,
        error: null,
        uploadProgress: 0,
        serverFile: null,
      };
      return next;
    });

    // Smaller chunks are more reliable on slower/flaky networks
    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId =
      Date.now().toString() + Math.random().toString(36).substring(2);

    try {
      const MAX_RETRIES = 3;

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        let attempt = 0;
        let success = false;
        let lastError: any = null;

        while (attempt < MAX_RETRIES && !success) {
          try {
            const formData = new FormData();
            formData.append("chunk", chunk);
            formData.append("uploadId", uploadId);
            formData.append("chunkIndex", i.toString());

            const response = await fetch(`${API_BASE}/api/upload/chunk`, {
              method: "POST",
              body: formData,
            });

            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(
                (errorData as any).error || `Failed to upload chunk ${i}`,
              );
            }

            success = true;
          } catch (err) {
            lastError = err;
            attempt += 1;
            if (attempt < MAX_RETRIES) {
              // Simple backoff before retrying
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * attempt),
              );
            }
          }
        }

        if (!success) {
          throw lastError || new Error(`Failed to upload chunk ${i}`);
        }

        const percent = Math.round(((i + 1) / totalChunks) * 100);
        setSessions((prev) => {
          const next = [...prev];
          const s = next[index];
          if (!s) return prev;
          next[index] = { ...s, uploadProgress: percent };
          return next;
        });
      }

      // Finalize upload
      const finalizeRes = await fetch(`${API_BASE}/api/upload/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId,
          filename: file.name,
          totalChunks,
        }),
      });

      if (!finalizeRes.ok) {
        const errorData = await finalizeRes.json();
        throw new Error(errorData.error || "Failed to finalize upload");
      }

      const data = (await finalizeRes.json()) as ServerFile;
      setSessions((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        next[index] = {
          ...next[index],
          serverFile: data,
          isUploading: false,
          currentTimeSeconds: 0,
        };
        return next;
      });
    } catch (err: any) {
      console.error("Upload Error:", err);
      setSessions((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        next[index] = {
          ...next[index],
          error: err.message || "An unexpected error occurred during upload.",
          isUploading: false,
        };
        return next;
      });
    }
  };

  const videoRef = useRef<HTMLVideoElement>(null);

  const skip = (seconds: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime += seconds;
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const currentTime = videoRef.current.currentTime;
    const index = activeIndex;
    setSessions((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = {
        ...next[index],
        currentTimeSeconds: currentTime,
      };
      return next;
    });
  };

  const scrubBarRef = useRef<HTMLDivElement>(null);

  const seekToFraction = (fraction: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, fraction));
    video.currentTime = clamped * video.duration;
  };

  const handleScrubPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const bar = scrubBarRef.current;
    if (!bar) return;

    const seekFromClientX = (clientX: number) => {
      const rect = bar.getBoundingClientRect();
      seekToFraction((clientX - rect.left) / rect.width);
    };

    seekFromClientX(e.clientX);

    const onMove = (moveEvent: PointerEvent) => {
      seekFromClientX(moveEvent.clientX);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const [scrubHover, setScrubHover] = useState<{
    percent: number;
    time: number;
  } | null>(null);

  const handleScrubHover = (e: React.MouseEvent) => {
    const bar = scrubBarRef.current;
    const duration = videoRef.current?.duration;
    if (!bar || !duration || !Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const rect = bar.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setScrubHover({ percent: fraction * 100, time: fraction * duration });
  };

  // Update streaming elapsed time and loop count while LIVE
  useEffect(() => {
    const interval = window.setInterval(() => {
      setSessions((prev) => {
        const now = Date.now();
        return prev.map((session) => {
          if (
            session.status !== "LIVE" ||
            !session.streamStartTime ||
            !session.serverFile
          ) {
            return session;
          }

          const elapsedSeconds = Math.max(
            0,
            Math.floor((now - session.streamStartTime) / 1000),
          );
          const duration = session.serverFile.duration || 0;
          const rawLoopCount =
            duration > 0 && session.loop
              ? Math.floor(elapsedSeconds / duration)
              : 0;

          const targetLoops = session.loopDurationSeconds;
          const limitedLoopCount =
            typeof targetLoops === "number"
              ? Math.min(rawLoopCount, Math.max(1, targetLoops))
              : rawLoopCount;

          const maxElapsed =
            typeof targetLoops === "number" && duration > 0
              ? targetLoops * duration
              : undefined;

          const limitedElapsedSeconds =
            typeof maxElapsed === "number"
              ? Math.min(elapsedSeconds, maxElapsed)
              : elapsedSeconds;

          const reachedConfiguredLoops =
            session.loop &&
            typeof targetLoops === "number" &&
            targetLoops > 0 &&
            rawLoopCount >= Math.max(1, targetLoops);

          return {
            ...session,
            streamElapsedSeconds: limitedElapsedSeconds,
            streamLoopCount: limitedLoopCount,
            // If we've reached the desired loop count, mark as finished
            ...(reachedConfiguredLoops
              ? {
                  status: "FINISHED" as const,
                  isStreaming: false,
                  streamId: null,
                }
              : {}),
          };
        });
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  // Poll backend for stream connection errors while streaming
  useEffect(() => {
    const hasActiveStreams = sessions.some((s) => s.isStreaming && s.streamId);
    if (!hasActiveStreams) return;

    const interval = window.setInterval(() => {
      sessions.forEach((session) => {
        if (!session.isStreaming || !session.streamId) return;

        fetch(`${API_BASE}/api/stream/status/${session.streamId}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data: any) => {
            if (!data || data.status !== "error") return;

            let backendMessage: string | null = null;
            if (typeof data.error === "string" && data.error.trim().length) {
              const raw = data.error.trim();

              // Prefer the short tail like "Error opening output files: I/O error"
              const marker = "Error opening output";
              const idx = raw.lastIndexOf(marker);
              if (idx !== -1) {
                backendMessage = raw.slice(idx).split("\n")[0].trim();
              } else {
                // Otherwise, just take the last line of the message
                const parts = raw.split("\n");
                backendMessage = parts[parts.length - 1].trim();
              }
            }

            const message =
              backendMessage ||
              "Failed to connect to stream. Please check your stream key.";

            setSessions((prev) => {
              const next = [...prev];
              const idx = next.findIndex(
                (s) => s.streamId === session.streamId,
              );
              if (idx === -1) return prev;

              next[idx] = {
                ...next[idx],
                error: message,
                isStreaming: false,
                status: "IDLE",
                streamId: null,
              };
              return next;
            });
          })
          .catch(() => {
            // Ignore polling errors; they will be retried on next interval.
          });
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [sessions]);

  const toggleLoop = () => {
    const index = activeIndex;
    setSessions((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = {
        ...next[index],
        loop: !next[index].loop,
      };
      return next;
    });
  };

  const handleLoopDurationChange = (timesStr: string) => {
    const index = activeIndex;
    setSessions((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;

      const times = parseInt(timesStr, 10);
      const safeTimes =
        Number.isFinite(times) && times > 0 ? Math.round(times) : null;

      next[index] = {
        ...next[index],
        loopDurationSeconds: safeTimes,
      };
      return next;
    });
  };

  const handleDownload = async () => {
    const url = downloadUrl.trim();
    if (!url) {
      setDownloadError("Please enter a video URL.");
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);
    setDownloadFileUrl(null);
    setDownloadProgress(0);
    setDownloadStatus("Starting download on server...");

    try {
      const res = await fetch(`${API_BASE}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, quality: downloadQuality }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          (data && (data as any).error) || "Download request failed.",
        );
      }

      setDownloadId((data as any).downloadId);
    } catch (err: any) {
      setDownloadError(err.message || "Download request failed.");
      setDownloadStatus(null);
      setIsDownloading(false);
    }
  };

  const handleStopDownload = async () => {
    if (!downloadId) return;
    try {
      await fetch(`${API_BASE}/api/download/stop/${downloadId}`, {
        method: "POST",
      });
    } catch {
      // Ignore; status polling will settle the UI state.
    }
  };

  // Poll backend for download progress once a download has been started
  useEffect(() => {
    if (!downloadId) return;

    const interval = window.setInterval(() => {
      fetch(`${API_BASE}/api/download/status/${downloadId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: any) => {
          if (!data) return;

          if (data.status === "processing") {
            setDownloadProgress(data.progress ?? 0);
            setDownloadStatus(`Downloading... ${Math.round(data.progress ?? 0)}%`);
            return;
          }

          if (data.status === "done") {
            setDownloadProgress(100);
            setDownloadStatus("Download ready.");
            setDownloadFileUrl(`${API_BASE}/api/downloads/${data.filename}`);
            setIsDownloading(false);
            setDownloadId(null);
            fetchServerVideos();
            return;
          }

          if (data.status === "error") {
            setDownloadError(data.error || "Download failed.");
            setDownloadStatus(null);
            setIsDownloading(false);
            setDownloadId(null);
            return;
          }

          if (data.status === "stopped") {
            setDownloadStatus("Download stopped.");
            setIsDownloading(false);
            setDownloadId(null);
          }
        })
        .catch(() => {
          // Ignore transient polling errors; retry on next tick.
        });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [downloadId]);

  const startStreaming = async () => {
    const index = activeIndex;
    const session = sessions[index];
    if (!session?.serverFile || session.streamKeys.some((k) => !k.trim())) {
      setSessions((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        next[index] = {
          ...next[index],
          error: "Please upload a video and provide all stream keys.",
        };
        return next;
      });
      return;
    }

    setSessions((prev) => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = {
        ...next[index],
        isStreaming: true,
        status: "LIVE",
        error: null,
        streamStartTime: Date.now(),
        streamElapsedSeconds: 0,
        streamLoopCount: 0,
      };
      return next;
    });

    try {
      const response = await fetch(`${API_BASE}/api/stream/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: session.serverFile.filename,
          streamKeys: session.streamKeys.filter((k) => k.trim()),
          loop: session.loop,
          loopTimes: session.loopDurationSeconds,
        }),
      });

      if (!response.ok) throw new Error("Failed to start streaming");

      const data = await response.json();
      setSessions((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        next[index] = { ...next[index], streamId: data.streamId };
        return next;
      });
    } catch (err: any) {
      setSessions((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        next[index] = {
          ...next[index],
          error: err.message,
          isStreaming: false,
          status: "IDLE",
        };
        return next;
      });
    }
  };

  const stopStreaming = async () => {
    const index = activeIndex;
    const session = sessions[index];
    if (!session?.streamId) return;

    try {
      const response = await fetch(`${API_BASE}/api/stream/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId: session.streamId }),
      });

      if (!response.ok) throw new Error("Failed to stop streaming");

      setSessions((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        next[index] = {
          ...next[index],
          isStreaming: false,
          streamId: null,
          status: "FINISHED",
        };
        return next;
      });
    } catch (err: any) {
      setSessions((prev) => {
        const next = [...prev];
        if (!next[index]) return prev;
        // Even if the backend reports a failure, treat this
        // stream as no longer LIVE in the UI so tabs can be closed.
        next[index] = {
          ...next[index],
          error: err.message,
          isStreaming: false,
          streamId: null,
          status: "FINISHED",
        };
        return next;
      });
    }
  };

  const current = sessions[activeIndex] ?? sessions[0];
  const hasLive = sessions.some((s) => s.status === "LIVE");

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-zinc-900/70 border border-zinc-800 rounded-2xl p-8 space-y-6">
          <div className="space-y-1 text-center">
            <h1 className="text-2xl font-bold tracking-tight bg-linear-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              Multi-Stream Live
            </h1>
            <p className="text-xs text-zinc-500">
              Admin sign in to manage streams.
            </p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-400">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/60"
                placeholder="admin@gmail.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-400">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/60"
                placeholder="••••••••"
              />
            </div>
            {authError && (
              <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {authError}
              </div>
            )}
            <button
              type="submit"
              className="w-full py-2.5 rounded-lg bg-emerald-500 text-sm font-semibold text-black hover:bg-emerald-400 transition-colors"
            >
              Sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-12">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-800 pb-8">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight bg-linear-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              Multi-Stream Live
            </h1>
            <div className="flex gap-2 pt-2 text-[11px]">
              <button
                type="button"
                onClick={() => setActivePage("stream")}
                className={`px-3 py-1 rounded-full border transition-colors ${activePage === "stream" ? "border-emerald-400 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"}`}
              >
                Streaming
              </button>
              <button
                type="button"
                onClick={() => setActivePage("download")}
                className={`px-3 py-1 rounded-full border transition-colors ${activePage === "download" ? "border-emerald-400 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"}`}
              >
                Downloader
              </button>
            </div>
            <div className="space-y-2">
              <p className="text-zinc-500 text-sm">
                {activePage === "stream"
                  ? "Broadcast your video to multiple Facebook Live destinations."
                  : "Prepare high-quality downloads for videos you are allowed to save."}
              </p>
              {activePage === "stream" && (
                <div className="flex items-center gap-2 overflow-x-auto pt-1">
                  {sessions.map((session, index) => {
                    const canClose =
                      sessions.length > 1 && session.status !== "LIVE";
                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => setActiveIndex(index)}
                        onDoubleClick={() => {
                          const newName = window.prompt(
                            "Rename stream",
                            session.name,
                          );
                          if (!newName || !newName.trim()) return;
                          setSessions((prev) => {
                            const next = [...prev];
                            if (!next[index]) return prev;
                            next[index] = {
                              ...next[index],
                              name: newName.trim(),
                            };
                            return next;
                          });
                        }}
                        className={`rounded-full px-3 py-1 text-[11px] font-medium border transition-colors flex items-center gap-1 ${
                          index === activeIndex
                            ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                            : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900"
                        }`}
                      >
                        <span>{session.name}</span>
                        {canClose && (
                          <span
                            className="ml-1 text-[10px] opacity-60 hover:opacity-100"
                            onClick={(e) => {
                              e.stopPropagation();
                              const total = sessions.length;
                              setSessions((prev) => {
                                if (prev.length <= 1) return prev;
                                const next = [...prev];
                                next.splice(index, 1);
                                return next;
                              });
                              setActiveIndex((prev) => {
                                if (prev === index) {
                                  if (index >= total - 1) {
                                    return Math.max(0, index - 1);
                                  }
                                  return index;
                                }
                                if (prev > index) return prev - 1;
                                return prev;
                              });
                            }}
                          >
                            ×
                          </span>
                        )}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setSessions((prev) => {
                        const next = [...prev];
                        const newSession = createEmptySession(prev.length + 1);
                        next.push(newSession);
                        return next;
                      });
                      setActiveIndex((prev) => prev + 1);
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-[11px] font-medium text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900"
                  >
                    <Plus className="w-3 h-3" />
                    New Stream
                  </button>
                  {!hasLive && sessions.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setSessions([createEmptySession(1)]);
                        setActiveIndex(0);
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 text-[11px] font-medium text-zinc-400 hover:border-red-500/50 hover:text-red-300"
                    >
                      Close All
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleLogout}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors border border-zinc-800 px-2 py-1 rounded"
            >
              LOG OUT
            </button>
            <button
              onClick={testConnection}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors border border-zinc-800 px-2 py-1 rounded"
            >
              {connectionStatus || "TEST API"}
            </button>
            {current?.status === "LIVE" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-500 text-xs font-medium"
              >
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                LIVE
              </motion.div>
            )}
            <Activity className="text-zinc-700 w-6 h-6" />
          </div>
        </header>

        {activePage === "stream" && (
          <main className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left Column: Upload & Settings */}
            <div className="space-y-8">
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Video className="w-4 h-4" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider">
                    Video Source
                  </h2>
                </div>

                <div className="flex gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setVideoSourceMode("device")}
                    className={`px-3 py-1 rounded-full border transition-colors ${videoSourceMode === "device" ? "border-emerald-400 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"}`}
                  >
                    From Device
                  </button>
                  <button
                    type="button"
                    onClick={() => setVideoSourceMode("server")}
                    className={`px-3 py-1 rounded-full border transition-colors ${videoSourceMode === "server" ? "border-emerald-400 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"}`}
                  >
                    From Server (Downloaded)
                  </button>
                </div>

                {videoSourceMode === "device" && (
                  <>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className={`
                      relative border-2 border-dashed rounded-2xl p-8 transition-all cursor-pointer group
                      ${current?.file ? "border-emerald-500/50 bg-emerald-500/5" : "border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50"}
                    `}
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="video/*"
                        className="hidden"
                      />

                      <div className="flex flex-col items-center text-center space-y-3">
                        <div
                          className={`p-4 rounded-full ${
                            current?.file
                              ? "bg-emerald-500/20 text-emerald-400"
                              : "bg-zinc-800 text-zinc-500 group-hover:text-zinc-400"
                          }`}
                        >
                          <Upload className="w-6 h-6" />
                        </div>
                        <div>
                          <p className="font-medium">
                            {current?.file
                              ? current.file.name
                              : "Choose a video file"}
                          </p>
                          <p className="text-xs text-zinc-500 mt-1">
                            MP4, MOV, or AVI preferred
                          </p>
                        </div>
                      </div>
                    </div>

                    {current?.isUploading && (
                      <div className="space-y-2">
                        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${current?.uploadProgress ?? 0}%` }}
                            className="h-full bg-blue-500"
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-zinc-500 font-mono">
                          <span>UPLOADING...</span>
                          <span>{current?.uploadProgress ?? 0}%</span>
                        </div>
                      </div>
                    )}

                    {current?.file &&
                      !current.serverFile &&
                      !current.isUploading && (
                        <button
                          onClick={uploadVideo}
                          className="w-full py-3 bg-zinc-100 text-zinc-900 rounded-xl font-semibold hover:bg-white transition-colors flex items-center justify-center gap-2"
                        >
                          Upload to Server
                          <CheckCircle2 className="w-4 h-4 opacity-0" />
                        </button>
                      )}
                  </>
                )}

                {videoSourceMode === "server" && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-zinc-500">
                        Pick a video previously fetched with the Downloader.
                      </p>
                      <button
                        type="button"
                        onClick={fetchServerVideos}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                      >
                        Refresh
                      </button>
                    </div>

                    {isLoadingServerVideos && (
                      <p className="text-xs text-zinc-500">Loading...</p>
                    )}

                    {serverVideosError && (
                      <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                        {serverVideosError}
                      </div>
                    )}

                    {!isLoadingServerVideos &&
                      !serverVideosError &&
                      serverVideos.length === 0 && (
                        <p className="text-xs text-zinc-500">
                          No downloaded videos yet. Use the Downloader tab
                          first.
                        </p>
                      )}

                    <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                      {serverVideos.map((v) => {
                        const isSelected =
                          current?.serverFile?.filename === v.filename;
                        const isSelecting = selectingServerVideo === v.filename;
                        return (
                          <div
                            key={v.filename}
                            className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${isSelected ? "border-emerald-500/50 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/60"}`}
                          >
                            <div className="min-w-0">
                              <p className="text-sm truncate" title={v.title}>
                                {v.title}
                              </p>
                              <p className="text-[10px] text-zinc-500">
                                {formatDuration(v.duration)} &middot;{" "}
                                {formatFileSize(v.size)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => selectServerVideo(v.filename)}
                              disabled={isSelecting}
                              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                                isSelected
                                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                                  : "bg-zinc-100 text-zinc-900 hover:bg-white"
                              }`}
                            >
                              {isSelecting
                                ? "Loading..."
                                : isSelected
                                  ? "Selected"
                                  : "Use"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {current?.serverFile && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2 text-emerald-400 text-sm bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/20">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" />
                        Video ready for streaming
                      </div>
                      <div className="font-mono bg-emerald-500/20 px-2 py-0.5 rounded text-xs">
                        {formatDuration(current.serverFile.duration)}
                      </div>
                    </div>

                    {/* Video Preview */}
                    <div className="relative group rounded-2xl overflow-hidden bg-black border border-zinc-800 aspect-video">
                      <video
                        ref={videoRef}
                        src={`${API_BASE}/api/uploads/${current.serverFile.filename}`}
                        className="w-full h-full object-contain"
                        controls={false}
                        onTimeUpdate={handleTimeUpdate}
                      />

                      <div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                        <div className="flex items-center justify-center gap-4">
                          <button
                            onClick={() => skip(-10)}
                            className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                            title="Back 10s"
                          >
                            <motion.div whileTap={{ scale: 0.9 }}>
                              <svg
                                className="w-5 h-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0019 16V8a1 1 0 00-1.6-.8l-5.334 4zM4.066 11.2a1 1 0 000 1.6l5.334 4A1 1 0 0011 16V8a1 1 0 00-1.6-.8l-5.334 4z"
                                />
                              </svg>
                            </motion.div>
                          </button>

                          <button
                            onClick={() =>
                              videoRef.current?.paused
                                ? videoRef.current.play()
                                : videoRef.current?.pause()
                            }
                            className="p-4 bg-white text-black rounded-full hover:scale-105 transition-transform"
                          >
                            <Play className="w-6 h-6 fill-current" />
                          </button>

                          <button
                            onClick={() => skip(10)}
                            className="p-2 bg-white/10 hover:bg-white/20 rounded-full transition-colors"
                            title="Forward 10s"
                          >
                            <motion.div whileTap={{ scale: 0.9 }}>
                              <svg
                                className="w-5 h-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M11.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 005 8v8a1 1 0 001.6.8l5.333-4zM19.933 12.8a1 1 0 000-1.6l-5.333-4A1 1 0 0013 8v8a1 1 0 001.6.8l5.333-4z"
                                />
                              </svg>
                            </motion.div>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Scrub bar: drag to seek to any point in the video */}
                    <div
                      ref={scrubBarRef}
                      onPointerDown={handleScrubPointerDown}
                      onMouseMove={handleScrubHover}
                      onMouseLeave={() => setScrubHover(null)}
                      className="relative h-2 rounded-full bg-zinc-800 cursor-pointer group/scrub"
                    >
                      {scrubHover && (
                        <div
                          className="absolute bottom-full mb-2 -translate-x-1/2 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-[10px] font-mono text-zinc-200 whitespace-nowrap pointer-events-none"
                          style={{ left: `${scrubHover.percent}%` }}
                        >
                          {formatDuration(scrubHover.time)}
                        </div>
                      )}
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-blue-500"
                        style={{
                          width: `${
                            current.serverFile.duration > 0
                              ? Math.min(
                                  100,
                                  ((current.currentTimeSeconds || 0) /
                                    current.serverFile.duration) *
                                    100,
                                )
                              : 0
                          }%`,
                        }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-blue-400 border-2 border-white/80 opacity-0 group-hover/scrub:opacity-100 transition-opacity"
                        style={{
                          left: `${
                            current.serverFile.duration > 0
                              ? Math.min(
                                  100,
                                  ((current.currentTimeSeconds || 0) /
                                    current.serverFile.duration) *
                                    100,
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>

                    <p className="mt-2 text-right text-[11px] text-zinc-500 font-mono">
                      Played: {formatDuration(current.currentTimeSeconds || 0)}
                    </p>
                    <p className="mt-1 text-right text-[11px] text-zinc-500 font-mono">
                      Stream time:{" "}
                      {formatDuration(current.streamElapsedSeconds || 0)}
                      {current.loop && (
                        <span className="ml-3">
                          Loops: {current.streamLoopCount}
                        </span>
                      )}
                    </p>
                  </div>
                )}
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Settings className="w-4 h-4" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider">
                    Stream Configuration
                  </h2>
                </div>

                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {current.streamKeys.map((key, index) => (
                      <motion.div
                        key={index}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="flex gap-2"
                      >
                        <div className="relative flex-1">
                          <input
                            type="password"
                            placeholder="Facebook Stream Key"
                            value={key}
                            onChange={(e) =>
                              updateStreamKey(index, e.target.value)
                            }
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-500/50 transition-colors"
                          />
                        </div>
                        <button
                          onClick={() => removeStreamKey(index)}
                          disabled={current.streamKeys.length === 1}
                          className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-red-400 hover:border-red-400/30 transition-all disabled:opacity-30"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>

                  <button
                    onClick={addStreamKey}
                    className="w-full py-3 border border-dashed border-zinc-800 rounded-xl text-zinc-500 text-sm font-medium hover:bg-zinc-900/50 hover:border-zinc-700 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Add Another Destination
                  </button>

                  <div className="flex items-center justify-between pt-2">
                    <div className="space-y-0.5">
                      <p className="text-xs font-medium text-zinc-300">
                        Loop video
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        Restart video automatically when it ends.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={toggleLoop}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${current.loop ? "bg-emerald-500/80 border-emerald-400" : "bg-zinc-800 border-zinc-700"}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${current.loop ? "translate-x-5" : "translate-x-1"}`}
                      />
                    </button>
                  </div>

                  {current.loop && (
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <p className="text-xs font-medium text-zinc-300">
                          Loop times
                        </p>
                        <p className="text-[10px] text-zinc-500">
                          How many times the video should loop.
                        </p>
                      </div>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={
                          typeof current.loopDurationSeconds === "number"
                            ? current.loopDurationSeconds
                            : ""
                        }
                        onChange={(e) =>
                          handleLoopDurationChange(e.target.value)
                        }
                        className="w-20 rounded-lg bg-zinc-900 border border-zinc-800 px-2 py-1 text-right text-xs focus:outline-none focus:border-emerald-500/60"
                        placeholder="times"
                      />
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* Right Column: Controls & Status */}
            <div className="space-y-8">
              <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 space-y-6">
                <div className="space-y-2">
                  <h3 className="text-xl font-bold">Broadcast Control</h3>
                  <p className="text-sm text-zinc-500">
                    Manage your live session and monitor performance.
                  </p>
                </div>

                <div className="space-y-4">
                  {(current.status === "IDLE" ||
                    current.status === "FINISHED") && (
                    <button
                      onClick={startStreaming}
                      disabled={!current.serverFile || current.isStreaming}
                      className="w-full py-6 bg-emerald-500 text-white rounded-2xl font-bold text-lg hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-3"
                    >
                      <Play className="w-6 h-6 fill-current" />
                      START STREAMING
                    </button>
                  )}
                  {current.status === "LIVE" && (
                    <button
                      onClick={stopStreaming}
                      className="w-full py-6 bg-red-500 text-white rounded-2xl font-bold text-lg hover:bg-red-400 transition-all shadow-lg shadow-red-500/20 flex items-center justify-center gap-3"
                    >
                      <Square className="w-6 h-6 fill-current" />
                      STOP ALL STREAMS
                    </button>
                  )}
                  {current.status === "FINISHED" && null}

                  {current.error && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm"
                    >
                      <AlertCircle className="w-5 h-5 shrink-0" />
                      <p>{current.error}</p>
                    </motion.div>
                  )}
                </div>

                <div className="pt-6 border-t border-zinc-800 grid grid-cols-2 gap-4">
                  <div className="bg-zinc-900 p-4 rounded-2xl space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                      Destinations
                    </p>
                    <p className="text-2xl font-mono font-bold">
                      {current.streamKeys.filter((k) => k.trim()).length}
                    </p>
                  </div>
                  <div className="bg-zinc-900 p-4 rounded-2xl space-y-1">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">
                      Status
                    </p>
                    <p
                      className={`text-2xl font-mono font-bold ${
                        current.status === "LIVE"
                          ? "text-emerald-400"
                          : current.status === "FINISHED"
                            ? "text-zinc-400"
                            : "text-zinc-600"
                      }`}
                    >
                      {current.status}
                    </p>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Activity className="w-4 h-4" />
                  <h2 className="text-sm font-semibold uppercase tracking-wider">
                    Live Feed Status
                  </h2>
                </div>

                <div className="space-y-2">
                  {current.streamKeys
                    .filter((k) => k.trim())
                    .map((_, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between p-4 bg-zinc-900/30 border border-zinc-800/50 rounded-xl"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              current.status === "LIVE"
                                ? "bg-emerald-500 animate-pulse"
                                : "bg-zinc-700"
                            }`}
                          />
                          <span className="text-sm font-medium">
                            Destination #{i + 1}
                          </span>
                        </div>
                        <span className="text-xs font-mono text-zinc-500">
                          {current.status === "LIVE"
                            ? "RTMP: CONNECTED"
                            : current.status === "FINISHED"
                              ? "FINISHED"
                              : "WAITING"}
                        </span>
                      </div>
                    ))}
                </div>
              </section>
            </div>
          </main>
        )}

        {activePage === "download" && (
          <main className="grid grid-cols-1 gap-8">
            <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 space-y-6">
              <div className="space-y-2">
                <h2 className="text-xl font-bold">Video Downloader</h2>
                <p className="text-sm text-zinc-500">
                  Paste a public Facebook video/live URL (or any link
                  supported by yt-dlp) that you own or are authorized to
                  download, pick a quality, and save it to your device.
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-400">
                    Video URL
                  </label>
                  <input
                    type="url"
                    value={downloadUrl}
                    onChange={(e) => setDownloadUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/60"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-400">
                    Quality
                  </label>
                  <div className="flex gap-2 text-[11px]">
                    {(["best", "medium", "low"] as const).map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setDownloadQuality(q)}
                        className={`px-3 py-1 rounded-full border transition-colors capitalize ${downloadQuality === q ? "border-emerald-400 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700"}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="flex-1 py-3 bg-emerald-500 text-white rounded-2xl font-semibold text-sm hover:bg-emerald-400 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isDownloading ? "DOWNLOADING..." : "DOWNLOAD VIDEO"}
                  </button>
                  {isDownloading && downloadId && (
                    <button
                      type="button"
                      onClick={handleStopDownload}
                      className="px-4 py-3 bg-zinc-800 text-zinc-300 rounded-2xl font-semibold text-sm hover:bg-zinc-700 transition-all"
                    >
                      Stop
                    </button>
                  )}
                </div>

                {isDownloading && (
                  <div className="space-y-2">
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${downloadProgress}%` }}
                        className="h-full bg-emerald-500"
                      />
                    </div>
                  </div>
                )}

                {downloadStatus && (
                  <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                    {downloadStatus}
                  </div>
                )}
                {downloadError && (
                  <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                    {downloadError}
                  </div>
                )}
                {downloadFileUrl && (
                  <a
                    href={downloadFileUrl}
                    download
                    className="w-full py-3 bg-blue-500 text-white rounded-2xl font-semibold text-sm hover:bg-blue-400 transition-all flex items-center justify-center gap-2"
                  >
                    SAVE FILE TO DEVICE
                  </a>
                )}
              </div>
            </section>

            <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-2">
                  <h2 className="text-xl font-bold">Downloaded Videos</h2>
                  <p className="text-sm text-zinc-500">
                    Manage everything saved on the server: preview, cut a
                    clip, or delete.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={fetchServerVideos}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2 shrink-0"
                >
                  Refresh
                </button>
              </div>

              {isLoadingServerVideos && (
                <p className="text-xs text-zinc-500">Loading...</p>
              )}
              {serverVideosError && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {serverVideosError}
                </div>
              )}
              {!isLoadingServerVideos &&
                !serverVideosError &&
                serverVideos.length === 0 && (
                  <p className="text-xs text-zinc-500">
                    No downloaded videos yet.
                  </p>
                )}

              <div className="space-y-2">
                {serverVideos.map((video) => (
                  <div
                    key={video.filename}
                    className="h-25 bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden flex items-center gap-4 p-2"
                  >
                    <div className="h-full aspect-video shrink-0 bg-black rounded-lg overflow-hidden">
                      <img
                        src={`${API_BASE}${video.thumbnailUrl}`}
                        alt={video.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-sm font-medium truncate"
                        title={video.title}
                      >
                        {video.title}
                      </p>
                      <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono mt-1">
                        <span>{formatDuration(video.duration)}</span>
                        <span>{formatFileSize(video.size)}</span>
                        <span className="text-zinc-600">
                          {formatDate(video.mtime)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openCutPanel(video)}
                        className="px-4 py-2 rounded-lg bg-zinc-100 text-zinc-900 text-xs font-semibold hover:bg-white transition-colors"
                      >
                        Edit / Cut
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteServerVideo(video.filename)}
                        disabled={deletingServerVideo === video.filename}
                        className="p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-400 hover:border-red-400/30 transition-all disabled:opacity-50"
                        title="Delete from server"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {cutTargetFilename && (
              <section className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h2 className="text-xl font-bold">Cut Video</h2>
                    <p className="text-sm text-zinc-500 truncate">
                      Editing: {cutTargetFilename}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeCutPanel}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 border border-zinc-800 px-2 py-1 rounded shrink-0"
                  >
                    CLOSE
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-400">
                      New name
                    </label>
                    <input
                      type="text"
                      value={cutNewName}
                      onChange={(e) => setCutNewName(e.target.value)}
                      placeholder="My clip"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500/60"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-400">
                      Time ranges (HH:MM:SS)
                    </label>
                    <div className="space-y-2">
                      {cutRanges.map((range, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-500 w-4 shrink-0">
                            {index + 1}
                          </span>
                          <input
                            type="text"
                            value={range.start}
                            onChange={(e) =>
                              updateCutRange(index, "start", e.target.value)
                            }
                            placeholder="00:00:00"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500/50"
                          />
                          <span className="text-zinc-600 text-xs shrink-0">
                            to
                          </span>
                          <input
                            type="text"
                            value={range.end}
                            onChange={(e) =>
                              updateCutRange(index, "end", e.target.value)
                            }
                            placeholder="00:00:10"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500/50"
                          />
                          <button
                            type="button"
                            onClick={() => removeCutRange(index)}
                            disabled={cutRanges.length === 1}
                            className="p-2 bg-zinc-900 border border-zinc-800 rounded-lg text-zinc-500 hover:text-red-400 hover:border-red-400/30 transition-all disabled:opacity-30 shrink-0"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={addCutRange}
                      className="w-full py-2 border border-dashed border-zinc-800 rounded-xl text-zinc-500 text-xs font-medium hover:bg-zinc-900/50 hover:border-zinc-700 transition-all flex items-center justify-center gap-2"
                    >
                      <Plus className="w-3 h-3" />
                      Add another time range
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCutSubmit}
                    disabled={isCutting}
                    className="w-full py-3 bg-emerald-500 text-white rounded-2xl font-semibold text-sm hover:bg-emerald-400 transition-all disabled:opacity-50"
                  >
                    {isCutting ? `CUTTING... ${cutProgress}%` : "COMBINE & SAVE CLIP"}
                  </button>

                  {isCutting && (
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${cutProgress}%` }}
                        className="h-full bg-emerald-500"
                      />
                    </div>
                  )}

                  {cutStatusMessage && (
                    <div className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                      {cutStatusMessage}
                    </div>
                  )}
                  {cutError && (
                    <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                      {cutError}
                    </div>
                  )}
                </div>
              </section>
            )}
          </main>
        )}

        <footer className="text-center pt-12 text-zinc-600 text-xs">
          <p>© 2026 Multi-Stream Live. Powered by NANG.</p>
        </footer>
      </div>
    </div>
  );
}
