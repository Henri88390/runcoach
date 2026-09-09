"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatEnglishDate, formatEnglishDateRange } from "../lib/date-format";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const apiFetch = (path: string, init?: RequestInit) =>
  fetch(`${API_BASE}${path}`, { ...init, credentials: "include" });

type WorkoutType =
  | "easy"
  | "tempo"
  | "interval"
  | "long"
  | "recovery"
  | "race"
  | "cross-training";

type Workout = {
  id: string;
  date: string;
  startTime?: string;
  title: string;
  type: WorkoutType;
  durationMinutes: number;
  distanceKm?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  effort: "easy" | "moderate" | "hard";
  notes?: string;
  source: "strava" | "manual";
  completed: boolean;
  tags?: string[];
};

type WeeklyWorkoutSummary = {
  weekStart: string;
  weekLabel: string;
  totalDistanceKm: number;
  totalMinutes: number;
  workouts: Workout[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  sources?: { coach: string; title: string; url: string }[];
  generationMode?: "local_llm" | "knowledge_fallback" | "openai";
};

type ModelProvider = "local" | "openai";

type ChatProviderOption = {
  id: ModelProvider;
  label: string;
  available: boolean;
};

type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
};

type ManualWorkoutForm = {
  title: string;
  type: WorkoutType;
  date: string;
  durationMinutes: number;
  distanceKm: number;
  averageHeartRate: number;
  effort: "easy" | "moderate" | "hard";
  notes: string;
  startTime: string;
};

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "Ask about your workouts, recovery, or general training strategy.",
    timestamp: new Date().toISOString(),
  },
];

const suggestedQuestions = [
  "How many kilometers per week should I run based on my recent training?",
  "What should my next week's training focus be?",
  "How can I increase my mileage while reducing injury risk?",
  "Is my current balance of easy and hard workouts appropriate?",
  "What should I do if I feel unusually tired during this training block?",
];

const formatDistance = (distanceKm: number) =>
  `${distanceKm.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}\u202Fkm`;

const formatDuration = (totalMinutes: number) => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}min`;
  return `${hours}h${String(minutes).padStart(2, "0")}min`;
};

const renderCitedAnswer = (content: string, sources: ChatMessage["sources"]) =>
  content.split(/(\[\d+\])/g).map((part, index) => {
    const citation = /^\[(\d+)\]$/.exec(part);
    const sourceIndex = citation ? Number(citation[1]) - 1 : -1;
    const source = sources?.[sourceIndex];

    if (!source) return <span key={index}>{part}</span>;

    return (
      <a
        key={index}
        className="chat-citation"
        href={source.url}
        target="_blank"
        rel="noreferrer"
        title={`${source.coach}: ${source.title}`}
      >
        {part}
      </a>
    );
  });

export default function HomePage() {
  const [weekly, setWeekly] = useState<WeeklyWorkoutSummary[]>([]);
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null);
  const [chatMessages, setChatMessages] =
    useState<ChatMessage[]>(initialMessages);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [magicLink, setMagicLink] = useState("");
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isStravaConnected, setIsStravaConnected] = useState(false);
  const [isStravaLoading, setIsStravaLoading] = useState(false);
  const [stravaMessage, setStravaMessage] = useState("");
  const [question, setQuestion] = useState("");
  const [coaches, setCoaches] = useState<string[]>([]);
  const [selectedCoaches, setSelectedCoaches] = useState<string[]>([]);
  const [chatProviders, setChatProviders] = useState<ChatProviderOption[]>([
    { id: "local", label: "Local model", available: true },
    { id: "openai", label: "OpenAI", available: true },
  ]);
  const [modelProvider, setModelProvider] = useState<ModelProvider>("local");
  const [isLoading, setIsLoading] = useState(false);
  const [visibleMetrics, setVisibleMetrics] = useState({
    distance: true,
    time: true,
  });
  const metricsMenuRef = useRef<HTMLDetailsElement>(null);
  const [isManualWorkoutModalOpen, setIsManualWorkoutModalOpen] =
    useState(false);
  const [isDeleteWorkoutModalOpen, setIsDeleteWorkoutModalOpen] =
    useState(false);
  const [isEditingWorkout, setIsEditingWorkout] = useState(false);
  const [editedWorkout, setEditedWorkout] = useState<Workout | null>(null);
  const [manualWorkout, setManualWorkout] = useState<ManualWorkoutForm>({
    title: "Manual workout",
    type: "easy",
    date: new Date().toISOString().slice(0, 10),
    startTime: "07:00",
    durationMinutes: 40,
    distanceKm: 6,
    averageHeartRate: 150,
    effort: "easy",
    notes: "Manually added run",
  });

  useEffect(() => {
    const loadSession = async () => {
      const response = await apiFetch("/auth/me");
      const payload = await response.json();
      setUser(payload.data ?? null);
      setIsAuthOpen(!payload.data);
      const stravaResult = new URLSearchParams(window.location.search).get(
        "strava",
      );
      if (stravaResult === "error") {
        setStravaMessage(
          "Strava connection failed. Please connect your Strava account again.",
        );
        window.history.replaceState({}, "", window.location.pathname);
      }
    };

    loadSession();
  }, []);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    setWeekly([]);
    setSelectedWorkout(null);

    const fetchWorkouts = async () => {
      const response = await apiFetch("/workouts/weekly");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      if (cancelled) return;
      setWeekly(payload.data ?? []);
      if (payload.data?.[0]?.workouts?.[0]) {
        setSelectedWorkout(payload.data[0].workouts[0]);
      }
    };

    const fetchStravaStatus = async () => {
      const response = await apiFetch("/strava/status");
      const payload = await response.json();
      if (cancelled) return;
      setIsStravaConnected(payload.data?.connected ?? false);
    };

    const fetchCoaches = async () => {
      const response = await apiFetch("/chat/coaches");
      const payload = await response.json();
      if (cancelled || !response.ok) return;
      setCoaches(payload.data ?? []);
      setSelectedCoaches(payload.data ?? []);
    };

    const fetchChatProviders = async () => {
      const response = await apiFetch("/chat/providers");
      const payload = await response.json();
      if (cancelled || !response.ok || !payload.data?.length) return;
      setChatProviders(payload.data);
    };

    void fetchWorkouts();
    void fetchStravaStatus();
    void fetchCoaches();
    void fetchChatProviders();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const onSynchronizeStrava = async () => {
    if (!isStravaConnected) {
      window.location.href = `${API_BASE}/strava/connect`;
      return;
    }

    setIsStravaLoading(true);
    setStravaMessage("");
    try {
      const response = await apiFetch("/strava/sync", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.message?.includes("authorization expired")) {
          setIsStravaConnected(false);
        }
        throw new Error(payload.message);
      }
      setStravaMessage(`${payload.data.imported} Strava workouts synchronized`);

      const weeklyResponse = await apiFetch("/workouts/weekly");
      const weeklyPayload = await weeklyResponse.json();
      setWeekly(weeklyPayload.data ?? []);
      setSelectedWorkout(weeklyPayload.data?.[0]?.workouts?.[0] ?? null);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("authorization expired")
      ) {
        setIsStravaConnected(false);
      }
      setStravaMessage(
        error instanceof Error
          ? error.message
          : "Strava synchronization failed",
      );
    } finally {
      setIsStravaLoading(false);
    }
  };

  const onRequestMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsAuthLoading(true);
    setAuthMessage("");
    setMagicLink("");
    try {
      const response = await apiFetch("/auth/email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: authEmail }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message);
      setAuthMessage(payload.message);
      setMagicLink(payload.data?.verificationUrl ?? "");
    } catch (error) {
      setAuthMessage(
        error instanceof Error ? error.message : "Could not send sign-in link",
      );
    } finally {
      setIsAuthLoading(false);
    }
  };

  const onLogout = async () => {
    await apiFetch("/auth/logout", { method: "POST" });
    setUser(null);
    setWeekly([]);
    setSelectedWorkout(null);
    setIsStravaConnected(false);
    setStravaMessage("");
    setIsAuthOpen(true);
  };

  useEffect(() => {
    if (!isManualWorkoutModalOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsManualWorkoutModalOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isManualWorkoutModalOpen]);

  useEffect(() => {
    if (!isDeleteWorkoutModalOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDeleteWorkoutModalOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isDeleteWorkoutModalOpen]);

  useEffect(() => {
    const closeMetricsMenu = (event: MouseEvent) => {
      if (
        metricsMenuRef.current &&
        !metricsMenuRef.current.contains(event.target as Node)
      ) {
        metricsMenuRef.current.removeAttribute("open");
      }
    };

    document.addEventListener("mousedown", closeMetricsMenu);
    return () => document.removeEventListener("mousedown", closeMetricsMenu);
  }, []);

  const onSendMessage = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setIsLoading(true);

    try {
      const response = await apiFetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: trimmed,
          selectedCoaches,
          trainingHistory: weekly.flatMap((week) => week.workouts),
          modelProvider,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Coach chat request failed");
      }
      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: payload.data?.answer ?? "No answer returned yet.",
        timestamp: new Date().toISOString(),
        sources: payload.data?.sources ?? [],
        generationMode: payload.data?.generationMode,
      };

      setChatMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content:
            "The AI service is unavailable right now. Please try again in a moment.",
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const onManualSubmit = async () => {
    const body: Workout = {
      id: "temp",
      date: manualWorkout.date,
      startTime: manualWorkout.startTime,
      title: manualWorkout.title,
      type: manualWorkout.type,
      durationMinutes: Number(manualWorkout.durationMinutes),
      distanceKm: Number(manualWorkout.distanceKm),
      averageHeartRate: Number(manualWorkout.averageHeartRate),
      effort: manualWorkout.effort,
      notes: manualWorkout.notes,
      source: "manual",
      completed: true,
      tags: ["manual"],
    };

    const response = await apiFetch("/workouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = await response.json();
    if (payload.success) {
      setSelectedWorkout(payload.data);
      setIsManualWorkoutModalOpen(false);

      const weeklyResponse = await apiFetch("/workouts/weekly");
      const weeklyPayload = await weeklyResponse.json();
      setWeekly(weeklyPayload.data ?? []);
    }
  };

  const onDeleteWorkout = async () => {
    if (!selectedWorkout) return;

    const response = await apiFetch(`/workouts/${selectedWorkout.id}`, {
      method: "DELETE",
    });
    const payload = await response.json();

    if (payload.success) {
      const weeklyResponse = await apiFetch("/workouts/weekly");
      const weeklyPayload = await weeklyResponse.json();
      const nextWeekly = weeklyPayload.data ?? [];
      setWeekly(nextWeekly);
      setSelectedWorkout(nextWeekly[0]?.workouts?.[0] ?? null);
      setIsDeleteWorkoutModalOpen(false);
    }
  };

  const onEditWorkout = () => {
    if (!selectedWorkout) return;
    setEditedWorkout({ ...selectedWorkout });
    setIsEditingWorkout(true);
  };

  const onSaveWorkout = async () => {
    if (!editedWorkout) return;

    const response = await apiFetch(`/workouts/${editedWorkout.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editedWorkout),
    });
    const payload = await response.json();

    if (payload.success) {
      setSelectedWorkout(payload.data);
      setEditedWorkout(null);
      setIsEditingWorkout(false);

      const weeklyResponse = await apiFetch("/workouts/weekly");
      const weeklyPayload = await weeklyResponse.json();
      setWeekly(weeklyPayload.data ?? []);
    }
  };

  return (
    <main>
      <div className="dashboard">
        <header className="topbar">
          <div>
            <div className="brand">RunCoach AI</div>
          </div>
          <div className="header-actions">
            {user ? (
              <>
                <span className="user-greeting">{user.name}</span>
                {isStravaConnected ? (
                  <button
                    className="button secondary"
                    onClick={onSynchronizeStrava}
                    disabled={isStravaLoading}
                  >
                    {isStravaLoading
                      ? "Synchronizing..."
                      : "Synchronize Strava account"}
                  </button>
                ) : (
                  <a
                    className="button secondary"
                    href={`${API_BASE}/strava/connect`}
                  >
                    Connect Strava account
                  </a>
                )}
                <button className="button secondary" onClick={onLogout}>
                  Log out
                </button>
                <button
                  className="button"
                  onClick={() => setIsManualWorkoutModalOpen(true)}
                >
                  Add workout
                </button>
              </>
            ) : (
              <>
                <button
                  className="button secondary"
                  onClick={() => {
                    setAuthMode("login");
                    setIsAuthOpen(true);
                  }}
                >
                  Log in
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setAuthMode("signup");
                    setIsAuthOpen(true);
                  }}
                >
                  Sign up
                </button>
              </>
            )}
          </div>
        </header>
        {user && stravaMessage && (
          <div className="sync-message" role="status">
            {stravaMessage}
          </div>
        )}

        <section className="panel history-panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <h2 style={{ margin: 0 }}>Training history</h2>
            <details className="metrics-menu" ref={metricsMenuRef}>
              <summary>Choose metrics</summary>
              <div className="metrics-menu-content">
                <label>
                  <input
                    type="checkbox"
                    checked={visibleMetrics.distance}
                    onChange={(event) =>
                      setVisibleMetrics((current) => ({
                        ...current,
                        distance: event.target.checked,
                      }))
                    }
                  />
                  Distance
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={visibleMetrics.time}
                    onChange={(event) =>
                      setVisibleMetrics((current) => ({
                        ...current,
                        time: event.target.checked,
                      }))
                    }
                  />
                  Time
                </label>
              </div>
            </details>
          </div>

          <div className="week-grid history-scroll">
            <div className="history-header" aria-hidden="true">
              <div />
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <div key={day}>{day}</div>
              ))}
            </div>
            {weekly.map((week) => (
              <div className="week-row" key={week.weekStart}>
                <div className="week-label">
                  <div>{formatEnglishDateRange(week.weekStart)}</div>
                  {(visibleMetrics.distance || visibleMetrics.time) && (
                    <div className="week-summary">
                      {visibleMetrics.distance && (
                        <div>
                          <span>Total distance</span>
                          <strong>
                            {formatDistance(week.totalDistanceKm)}
                          </strong>
                        </div>
                      )}
                      {visibleMetrics.time && (
                        <div>
                          <span>Total time</span>
                          <strong>{formatDuration(week.totalMinutes)}</strong>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {Array.from({ length: 7 }, (_, index) => {
                  const date = new Date(week.weekStart);
                  date.setDate(date.getDate() + index);
                  const dayString = date.toISOString().slice(0, 10);
                  const dayWorkouts = week.workouts.filter(
                    (item) => item.date === dayString,
                  );

                  return (
                    <div
                      key={`${week.weekStart}-${dayString}`}
                      className={`day-box ${
                        dayWorkouts.length === 0 ? "empty" : "clickable"
                      }`}
                      role={dayWorkouts.length > 0 ? "button" : undefined}
                      tabIndex={dayWorkouts.length > 0 ? 0 : undefined}
                      onClick={() => {
                        if (dayWorkouts[0]) setSelectedWorkout(dayWorkouts[0]);
                      }}
                      onKeyDown={(event) => {
                        if (
                          dayWorkouts[0] &&
                          (event.key === "Enter" || event.key === " ")
                        ) {
                          event.preventDefault();
                          setSelectedWorkout(dayWorkouts[0]);
                        }
                      }}
                    >
                      <div
                        className={`day-meta ${
                          dayWorkouts.some(
                            (workout) => workout.id === selectedWorkout?.id,
                          )
                            ? "selected"
                            : ""
                        }`}
                      >
                        {new Date(`${dayString}T00:00:00`).getDate()}
                      </div>
                      {dayWorkouts.length > 0 ? (
                        <div className="day-workouts">
                          {dayWorkouts.map((workout) => (
                            <button
                              key={workout.id}
                              className={`day-workout ${
                                selectedWorkout?.id === workout.id
                                  ? "selected"
                                  : ""
                              }`}
                              aria-pressed={selectedWorkout?.id === workout.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedWorkout(workout);
                              }}
                            >
                              <div className="workout-pill">{workout.type}</div>
                              <div className="day-workout-title">
                                {workout.title}
                              </div>
                              {workout.startTime && (
                                <div className="day-workout-time">
                                  {workout.startTime.slice(0, 5)}
                                </div>
                              )}
                              <div className="workout-hover-details">
                                <span>
                                  {formatDuration(workout.durationMinutes)}
                                </span>
                                <span>
                                  {formatDistance(workout.distanceKm ?? 0)}
                                </span>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="subtle">—</div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>

        <section className="grid lower-grid">
          <div className="panel">
            <div className="details-header">
              <h2 style={{ margin: 0 }}>Workout details</h2>
              {selectedWorkout && (
                <div className="details-actions">
                  {!isEditingWorkout && (
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Edit workout"
                      title="Edit workout"
                      onClick={onEditWorkout}
                    >
                      ✎
                    </button>
                  )}
                  <button
                    className="icon-button"
                    type="button"
                    aria-label="Delete workout"
                    title="Delete workout"
                    onClick={() => setIsDeleteWorkoutModalOpen(true)}
                  >
                    🗑
                  </button>
                </div>
              )}
            </div>
            {selectedWorkout ? (
              isEditingWorkout && editedWorkout ? (
                <div className="edit-workout-form">
                  <label className="field-label">
                    Workout title
                    <input
                      className="input"
                      value={editedWorkout.title}
                      onChange={(event) =>
                        setEditedWorkout({
                          ...editedWorkout,
                          title: event.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="form-row form-row-three">
                    <label className="field-label">
                      Start time
                      <input
                        className="input"
                        type="time"
                        value={editedWorkout.startTime ?? ""}
                        onChange={(event) =>
                          setEditedWorkout({
                            ...editedWorkout,
                            startTime: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Date
                      <input
                        className="input"
                        type="date"
                        value={editedWorkout.date}
                        onChange={(event) =>
                          setEditedWorkout({
                            ...editedWorkout,
                            date: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Workout type
                      <select
                        className="select"
                        value={editedWorkout.type}
                        onChange={(event) =>
                          setEditedWorkout({
                            ...editedWorkout,
                            type: event.target.value as WorkoutType,
                          })
                        }
                      >
                        <option value="easy">Easy</option>
                        <option value="tempo">Tempo</option>
                        <option value="interval">Interval</option>
                        <option value="long">Long</option>
                        <option value="recovery">Recovery</option>
                        <option value="race">Race</option>
                        <option value="cross-training">Cross-training</option>
                      </select>
                    </label>
                  </div>
                  <div className="form-row">
                    <label className="field-label">
                      Duration (minutes)
                      <input
                        className="input"
                        type="number"
                        min="0"
                        value={editedWorkout.durationMinutes}
                        onChange={(event) =>
                          setEditedWorkout({
                            ...editedWorkout,
                            durationMinutes: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Distance (km)
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.1"
                        value={editedWorkout.distanceKm ?? 0}
                        onChange={(event) =>
                          setEditedWorkout({
                            ...editedWorkout,
                            distanceKm: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="form-row">
                    <label className="field-label">
                      Average heart rate (bpm)
                      <input
                        className="input"
                        type="number"
                        min="0"
                        value={editedWorkout.averageHeartRate ?? 0}
                        onChange={(event) =>
                          setEditedWorkout({
                            ...editedWorkout,
                            averageHeartRate: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                    <label className="field-label">
                      Effort
                      <select
                        className="select"
                        value={editedWorkout.effort}
                        onChange={(event) =>
                          setEditedWorkout({
                            ...editedWorkout,
                            effort: event.target.value as Workout["effort"],
                          })
                        }
                      >
                        <option value="easy">Easy</option>
                        <option value="moderate">Moderate</option>
                        <option value="hard">Hard</option>
                      </select>
                    </label>
                  </div>
                  <label className="field-label">
                    Notes
                    <textarea
                      className="textarea"
                      value={editedWorkout.notes ?? ""}
                      onChange={(event) =>
                        setEditedWorkout({
                          ...editedWorkout,
                          notes: event.target.value,
                        })
                      }
                    />
                  </label>
                  <div className="edit-actions">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => {
                        setEditedWorkout(null);
                        setIsEditingWorkout(false);
                      }}
                    >
                      Cancel
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={onSaveWorkout}
                    >
                      Save workout
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                    {selectedWorkout.title}
                  </div>
                  <div className="subtle" style={{ marginTop: 6 }}>
                    {formatEnglishDate(selectedWorkout.date)}
                    {selectedWorkout.startTime &&
                      ` at ${selectedWorkout.startTime.slice(0, 5)}`}
                  </div>
                  <div className="metric-grid">
                    <div className="metric">
                      <div className="label">Duration</div>
                      <div className="value">
                        {selectedWorkout.durationMinutes} min
                      </div>
                    </div>
                    <div className="metric">
                      <div className="label">Distance</div>
                      <div className="value">
                        {selectedWorkout.distanceKm ?? 0} km
                      </div>
                    </div>
                    <div className="metric">
                      <div className="label">Avg HR</div>
                      <div className="value">
                        {selectedWorkout.averageHeartRate ?? "--"} bpm
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 18,
                      lineHeight: 1.6,
                      color: "var(--muted)",
                    }}
                  >
                    {selectedWorkout.notes}
                  </div>
                </>
              )
            ) : (
              <div className="subtle">Select a workout to view details.</div>
            )}
          </div>

          <div className="panel chat-panel">
            <h2 style={{ marginTop: 0 }}>Coach chat</h2>
            <fieldset className="coach-filter">
              <legend>Answer using</legend>
              {chatProviders.map((provider) => (
                <label key={provider.id}>
                  <input
                    type="radio"
                    name="model-provider"
                    checked={modelProvider === provider.id}
                    disabled={!provider.available}
                    onChange={() => setModelProvider(provider.id)}
                  />
                  {provider.label}
                </label>
              ))}
            </fieldset>
            <fieldset className="coach-filter">
              <legend>Answer from</legend>
              {coaches.map((coach) => (
                <label key={coach}>
                  <input
                    type="checkbox"
                    checked={selectedCoaches.includes(coach)}
                    disabled={
                      selectedCoaches.length === 1 &&
                      selectedCoaches.includes(coach)
                    }
                    onChange={(event) =>
                      setSelectedCoaches((current) =>
                        event.target.checked
                          ? [...current, coach]
                          : current.filter((item) => item !== coach),
                      )
                    }
                  />
                  {coach}
                </label>
              ))}
            </fieldset>
            <div className="chat-suggestions" aria-label="Suggested questions">
              <span className="chat-suggestions-label">Try asking</span>
              <div className="chat-suggestion-list">
                {suggestedQuestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="chat-suggestion"
                    type="button"
                    onClick={() => setQuestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
            <div className="chat-box">
              <div className="chat-history">
                {chatMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`chat-message ${message.role}`}
                  >
                    {message.role === "assistant"
                      ? renderCitedAnswer(message.content, message.sources)
                      : message.content}
                    {message.role === "assistant" && message.generationMode && (
                      <div className="chat-generation-mode">
                        {message.generationMode === "local_llm"
                          ? "Generated by local model"
                          : message.generationMode === "openai"
                            ? "Generated by OpenAI"
                            : "Grounded knowledge fallback"}
                      </div>
                    )}
                    {message.role === "assistant" && message.sources?.length ? (
                      <div className="chat-sources">
                        <strong>Sources</strong>
                        {message.sources.map((source) => (
                          <a
                            key={`${message.id}-${source.url}`}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.coach}: {source.title}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {isLoading && (
                  <div className="chat-message assistant">Thinking…</div>
                )}
              </div>

              <div className="chat-form">
                <input
                  className="chat-input"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about your training..."
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onSendMessage();
                  }}
                />
                <button
                  className="button"
                  onClick={onSendMessage}
                  disabled={isLoading}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </section>

        {isAuthOpen && (
          <div className="modal-backdrop" role="presentation">
            <section
              className="modal auth-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="auth-title"
            >
              <div className="modal-header">
                <h2 id="auth-title">
                  {authMode === "login"
                    ? "Log in to RunCoach"
                    : "Create your RunCoach account"}
                </h2>
                {user && (
                  <button
                    className="modal-close"
                    type="button"
                    aria-label="Close account dialog"
                    onClick={() => setIsAuthOpen(false)}
                  >
                    ×
                  </button>
                )}
              </div>
              <p className="confirmation-copy">
                {authMode === "login"
                  ? "Use Google or your email to access your existing account and keep your workouts synced."
                  : "Create an account to keep your workouts private and synced."}
              </p>
              <a className="oauth-button" href={`${API_BASE}/auth/google`}>
                {authMode === "login"
                  ? "Continue with Google"
                  : "Create account with Google"}
              </a>
              <div className="auth-divider">or use your email</div>
              <form className="auth-form" onSubmit={onRequestMagicLink}>
                <label className="field-label">
                  Email address
                  <input
                    className="input"
                    type="email"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    placeholder="you@example.com"
                    required
                  />
                </label>
                <button
                  className="button"
                  type="submit"
                  disabled={isAuthLoading}
                >
                  {isAuthLoading ? "Sending..." : "Email me a sign-in link"}
                </button>
              </form>
              {authMessage && <p className="auth-message">{authMessage}</p>}
              {magicLink && (
                <a className="auth-dev-link" href={magicLink}>
                  Open sign-in link (local development)
                </a>
              )}
            </section>
          </div>
        )}

        {isDeleteWorkoutModalOpen && selectedWorkout && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsDeleteWorkoutModalOpen(false);
              }
            }}
          >
            <section
              className="modal confirmation-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-workout-title"
            >
              <div className="modal-header">
                <h2 id="delete-workout-title">Delete workout?</h2>
                <button
                  className="modal-close"
                  type="button"
                  aria-label="Close delete workout dialog"
                  onClick={() => setIsDeleteWorkoutModalOpen(false)}
                >
                  ×
                </button>
              </div>
              <p className="confirmation-copy">
                Are you sure you want to delete “{selectedWorkout.title}”? This
                action cannot be undone.
              </p>
              <div className="confirmation-actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setIsDeleteWorkoutModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="button danger"
                  type="button"
                  onClick={onDeleteWorkout}
                >
                  Delete workout
                </button>
              </div>
            </section>
          </div>
        )}

        {isManualWorkoutModalOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsManualWorkoutModalOpen(false);
              }
            }}
          >
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="manual-workout-title"
            >
              <div className="modal-header">
                <h2 id="manual-workout-title">Add manual workout</h2>
                <button
                  className="modal-close"
                  type="button"
                  aria-label="Close add workout dialog"
                  onClick={() => setIsManualWorkoutModalOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="form-grid">
                <label className="field-label">
                  Workout title
                  <input
                    className="input"
                    value={manualWorkout.title}
                    onChange={(event) =>
                      setManualWorkout((prev) => ({
                        ...prev,
                        title: event.target.value,
                      }))
                    }
                    placeholder="e.g. Easy recovery run"
                  />
                </label>
                <div className="form-row form-row-three">
                  <label className="field-label">
                    Start time
                    <input
                      className="input"
                      type="time"
                      value={manualWorkout.startTime}
                      onChange={(event) =>
                        setManualWorkout((prev) => ({
                          ...prev,
                          startTime: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label className="field-label">
                    Date
                    <input
                      className="input"
                      type="date"
                      value={manualWorkout.date}
                      onChange={(event) =>
                        setManualWorkout((prev) => ({
                          ...prev,
                          date: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field-label">
                    Workout type
                    <select
                      className="select"
                      value={manualWorkout.type}
                      onChange={(event) =>
                        setManualWorkout((prev) => ({
                          ...prev,
                          type: event.target.value as WorkoutType,
                        }))
                      }
                    >
                      <option value="easy">Easy</option>
                      <option value="tempo">Tempo</option>
                      <option value="interval">Interval</option>
                      <option value="long">Long</option>
                      <option value="recovery">Recovery</option>
                      <option value="race">Race</option>
                      <option value="cross-training">Cross-training</option>
                    </select>
                  </label>
                </div>
                <div className="form-row">
                  <label className="field-label">
                    Duration (minutes)
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={manualWorkout.durationMinutes}
                      onChange={(event) =>
                        setManualWorkout((prev) => ({
                          ...prev,
                          durationMinutes: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label className="field-label">
                    Distance (km)
                    <input
                      className="input"
                      type="number"
                      min="0"
                      step="0.1"
                      value={manualWorkout.distanceKm}
                      onChange={(event) =>
                        setManualWorkout((prev) => ({
                          ...prev,
                          distanceKm: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                </div>
                <div className="form-row">
                  <label className="field-label">
                    Average heart rate (bpm)
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={manualWorkout.averageHeartRate}
                      onChange={(event) =>
                        setManualWorkout((prev) => ({
                          ...prev,
                          averageHeartRate: Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                  <label className="field-label">
                    Effort
                    <select
                      className="select"
                      value={manualWorkout.effort}
                      onChange={(event) =>
                        setManualWorkout((prev) => ({
                          ...prev,
                          effort: event.target.value as
                            | "easy"
                            | "moderate"
                            | "hard",
                        }))
                      }
                    >
                      <option value="easy">Easy</option>
                      <option value="moderate">Moderate</option>
                      <option value="hard">Hard</option>
                    </select>
                  </label>
                </div>
                <label className="field-label">
                  Notes
                  <textarea
                    className="textarea"
                    value={manualWorkout.notes}
                    onChange={(event) =>
                      setManualWorkout((prev) => ({
                        ...prev,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Add details about the workout"
                  />
                </label>
                <button className="button" onClick={onManualSubmit}>
                  Save workout
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
