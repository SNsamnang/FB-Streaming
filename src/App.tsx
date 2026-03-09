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

type ServerFile = {
  filename: string;
  path: string;
  duration: number;
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
      const res = await fetch("/api/ping");
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

    const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId =
      Date.now().toString() + Math.random().toString(36).substring(2);

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const formData = new FormData();
        formData.append("chunk", chunk);
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", i.toString());

        const response = await fetch("/api/upload/chunk", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || `Failed to upload chunk ${i}`);
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
      const finalizeRes = await fetch("/api/upload/finalize", {
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
      };
      return next;
    });

    try {
      const response = await fetch("/api/stream/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: session.serverFile.filename,
          streamKeys: session.streamKeys.filter((k) => k.trim()),
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
      const response = await fetch("/api/stream/stop", {
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
            <div className="space-y-2">
              <p className="text-zinc-500 text-sm">
                Broadcast your video to multiple Facebook Live destinations.
              </p>
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

              {current?.file && !current.serverFile && !current.isUploading && (
                <button
                  onClick={uploadVideo}
                  className="w-full py-3 bg-zinc-100 text-zinc-900 rounded-xl font-semibold hover:bg-white transition-colors flex items-center justify-center gap-2"
                >
                  Upload to Server
                  <CheckCircle2 className="w-4 h-4 opacity-0" />
                </button>
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
                      src={`/api/uploads/${current.serverFile.filename}`}
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
                  <p className="mt-2 text-right text-[11px] text-zinc-500 font-mono">
                    Played: {formatDuration(current.currentTimeSeconds || 0)}
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

        <footer className="text-center pt-12 text-zinc-600 text-xs">
          <p>© 2024 Multi-Stream Live. Powered by FFmpeg & React.</p>
        </footer>
      </div>
    </div>
  );
}
