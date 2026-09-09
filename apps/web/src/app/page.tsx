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
  | "threshold"
  | "interval"
  | "vo2max"
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
  source: "strava" | "manual" | "plan";
  completed: boolean;
  tags?: string[];
  planId?: string;
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

type PlanGoalType = "precise" | "general";

type GeneralGoalCategory =
  | "speed"
  | "endurance"
  | "general"
  | "maintenance"
  | "custom";

type TrainingPlanStatus = "queued" | "generating" | "ready" | "failed";

type PlanWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

type WeeklySchedule = Partial<Record<PlanWeekday, 1 | 2>>;

const weekdayOptions: { value: PlanWeekday; label: string }[] = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

const defaultWeeklySchedule: WeeklySchedule = {
  tue: 1,
  thu: 1,
  sat: 1,
  sun: 1,
};

type TrainingPlan = {
  id: string;
  name: string;
  goalType: PlanGoalType;
  raceName?: string;
  raceDistanceKm?: number;
  goalDate: string;
  startDate: string;
  goalTimeSeconds?: number;
  generalGoalCategory?: GeneralGoalCategory;
  generalGoalDescription?: string;
  selectedCoaches: string[];
  weeklySchedule: WeeklySchedule;
  status: TrainingPlanStatus;
  error?: string;
  createdAt: string;
};

type PlanForm = {
  goalType: PlanGoalType;
  generalPlanName: string;
  raceName: string;
  raceDate: string;
  raceDistancePreset: string;
  raceDistanceKm: number;
  goalHours: number;
  goalMinutes: number;
  goalSeconds: number;
  generalGoalCategory: GeneralGoalCategory;
  generalGoalDescription: string;
  planEndDate: string;
  startDate: string;
  selectedCoaches: string[];
  weeklySchedule: WeeklySchedule;
  hasRecentRace: boolean;
  recentRaceDistancePreset: string;
  recentRaceDistanceKm: number;
  recentRaceHours: number;
  recentRaceMinutes: number;
  recentRaceSeconds: number;
};

const raceDistancePresets: { value: string; label: string; km?: number }[] = [
  { value: "5k", label: "5K", km: 5 },
  { value: "10k", label: "10K", km: 10 },
  { value: "15k", label: "15K", km: 15 },
  { value: "10-mile", label: "10 miles", km: 16.0934 },
  { value: "half-marathon", label: "Half marathon", km: 21.0975 },
  { value: "marathon", label: "Marathon", km: 42.195 },
  { value: "custom", label: "Custom distance" },
];

const generalGoalLabels: Record<GeneralGoalCategory, string> = {
  speed: "Improve top-end speed",
  endurance: "Improve endurance",
  general: "General development",
  maintenance: "Maintenance",
  custom: "Other (describe below)",
};

const addDaysToToday = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const defaultPlanForm: PlanForm = {
  goalType: "precise",
  generalPlanName: "",
  raceName: "10K race",
  raceDate: addDaysToToday(84),
  raceDistancePreset: "10k",
  raceDistanceKm: 10,
  goalHours: 0,
  goalMinutes: 37,
  goalSeconds: 0,
  generalGoalCategory: "general",
  generalGoalDescription: "",
  planEndDate: addDaysToToday(84),
  startDate: "",
  selectedCoaches: [],
  weeklySchedule: defaultWeeklySchedule,
  hasRecentRace: false,
  recentRaceDistancePreset: "10k",
  recentRaceDistanceKm: 10,
  recentRaceHours: 0,
  recentRaceMinutes: 45,
  recentRaceSeconds: 0,
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

const formatPace = (durationMinutes: number, distanceKm?: number) => {
  if (!distanceKm) return "--";
  const secPerKm = Math.round((durationMinutes * 60) / distanceKm);
  const minutes = Math.floor(secPerKm / 60);
  const seconds = secPerKm % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}/km`;
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
  const [activeTab, setActiveTab] = useState<string>("history");
  const [plans, setPlans] = useState<TrainingPlan[]>([]);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isPlanSubmitting, setIsPlanSubmitting] = useState(false);
  const [planMessage, setPlanMessage] = useState("");
  const [planForm, setPlanForm] = useState<PlanForm>(defaultPlanForm);
  const [planToDelete, setPlanToDelete] = useState<TrainingPlan | null>(null);

  const switchTab = (tab: string) => {
    setActiveTab(tab);
    setSelectedWorkout(null);
  };

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

    const fetchPlans = async () => {
      const response = await apiFetch("/plans");
      const payload = await response.json();
      if (cancelled || !response.ok) return;
      setPlans(payload.data ?? []);
    };

    void fetchWorkouts();
    void fetchStravaStatus();
    void fetchCoaches();
    void fetchChatProviders();
    void fetchPlans();

    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const hasPendingPlan = plans.some(
      (plan) => plan.status === "queued" || plan.status === "generating",
    );
    if (!hasPendingPlan) return;

    const interval = setInterval(async () => {
      const plansResponse = await apiFetch("/plans");
      const plansPayload = await plansResponse.json();
      if (plansResponse.ok) {
        const nextPlans = plansPayload.data ?? [];
        setPlans(nextPlans);
        const stillPending = nextPlans.some(
          (plan: TrainingPlan) =>
            plan.status === "queued" || plan.status === "generating",
        );
        if (!stillPending) setPlanMessage("");
      }

      const weeklyResponse = await apiFetch("/workouts/weekly");
      const weeklyPayload = await weeklyResponse.json();
      if (weeklyResponse.ok) setWeekly(weeklyPayload.data ?? []);
    }, 3000);

    return () => clearInterval(interval);
  }, [user, plans]);

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

  const onCreatePlan = async () => {
    if (planForm.goalType === "general" && !planForm.generalPlanName.trim()) {
      setPlanMessage("A plan name is required for a general goal plan.");
      return;
    }

    setIsPlanSubmitting(true);
    setPlanMessage("");

    try {
      const recentRace = planForm.hasRecentRace
        ? {
            recentRaceDistanceKm: Number(planForm.recentRaceDistanceKm),
            recentRaceTimeSeconds:
              planForm.recentRaceHours * 3600 +
              planForm.recentRaceMinutes * 60 +
              planForm.recentRaceSeconds,
          }
        : {};

      const body =
        planForm.goalType === "precise"
          ? {
              name: planForm.raceName.trim() || undefined,
              goalType: "precise" as const,
              raceName: planForm.raceName,
              raceDistanceKm: Number(planForm.raceDistanceKm),
              goalDate: planForm.raceDate,
              startDate: planForm.startDate || undefined,
              goalTimeSeconds:
                planForm.goalHours * 3600 +
                planForm.goalMinutes * 60 +
                planForm.goalSeconds,
              selectedCoaches: planForm.selectedCoaches,
              weeklySchedule: planForm.weeklySchedule,
              ...recentRace,
            }
          : {
              name: planForm.generalPlanName.trim(),
              goalType: "general" as const,
              generalGoalCategory: planForm.generalGoalCategory,
              generalGoalDescription: planForm.generalGoalDescription,
              goalDate: planForm.planEndDate,
              startDate: planForm.startDate || undefined,
              selectedCoaches: planForm.selectedCoaches,
              weeklySchedule: planForm.weeklySchedule,
              ...recentRace,
            };

      const response = await apiFetch("/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(
          payload.message ?? "Could not create the training plan",
        );
      }

      setPlans((prev) => [payload.data, ...prev]);
      setIsPlanModalOpen(false);
      setPlanForm(defaultPlanForm);
      switchTab(payload.data.id);
      setPlanMessage("Your training plan is generating in the background.");
    } catch (error) {
      setPlanMessage(
        error instanceof Error
          ? error.message
          : "Could not create the training plan",
      );
    } finally {
      setIsPlanSubmitting(false);
    }
  };

  const onDeletePlan = async () => {
    if (!planToDelete) return;

    const response = await apiFetch(`/plans/${planToDelete.id}`, {
      method: "DELETE",
    });
    const payload = await response.json();

    if (payload.success) {
      setPlans((prev) => prev.filter((plan) => plan.id !== planToDelete.id));
      if (activeTab === planToDelete.id) switchTab("history");
      setPlanToDelete(null);

      const weeklyResponse = await apiFetch("/workouts/weekly");
      const weeklyPayload = await weeklyResponse.json();
      setWeekly(weeklyPayload.data ?? []);
    }
  };

  const toggleScheduleDay = (day: PlanWeekday) => {
    setPlanForm((prev) => {
      const next = { ...prev.weeklySchedule };
      if (next[day]) {
        delete next[day];
      } else {
        next[day] = 1;
      }
      return { ...prev, weeklySchedule: next };
    });
  };

  const setScheduleDayRuns = (day: PlanWeekday, runs: 1 | 2) => {
    setPlanForm((prev) => ({
      ...prev,
      weeklySchedule: { ...prev.weeklySchedule, [day]: runs },
    }));
  };

  const historyWeekly = weekly
    .map((week) => ({
      ...week,
      workouts: week.workouts.filter(
        (workout) => !(workout.source === "plan" && !workout.completed),
      ),
    }))
    .filter((week) => week.workouts.length > 0);

  const planWeekly = (planId: string) =>
    weekly
      .map((week) => ({
        ...week,
        workouts: week.workouts.filter(
          (workout) =>
            workout.planId === planId ||
            !(workout.source === "plan" && !workout.completed),
        ),
      }))
      .filter((week) => week.workouts.length > 0);

  const activePlan = plans.find((plan) => plan.id === activeTab);
  const displayedWeekly =
    activeTab === "history"
      ? historyWeekly
      : activePlan
        ? planWeekly(activePlan.id)
        : [];

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
                  className="button secondary"
                  onClick={() => setIsPlanModalOpen(true)}
                >
                  Create training plan
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
        {user && planMessage && (
          <div className="sync-message" role="status">
            {planMessage}
          </div>
        )}

        {user && (
          <div className="tab-bar" role="tablist">
            <button
              className={`tab ${activeTab === "history" ? "active" : ""}`}
              role="tab"
              aria-selected={activeTab === "history"}
              onClick={() => switchTab("history")}
            >
              Training history
            </button>
            {plans.map((plan) => (
              <button
                key={plan.id}
                className={`tab ${activeTab === plan.id ? "active" : ""}`}
                role="tab"
                aria-selected={activeTab === plan.id}
                onClick={() => switchTab(plan.id)}
              >
                {plan.name}
                {(plan.status === "queued" || plan.status === "generating") &&
                  " · generating…"}
                {plan.status === "failed" && " · failed"}
              </button>
            ))}
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
            <h2 style={{ margin: 0 }}>
              {activeTab === "history"
                ? "Training history"
                : (activePlan?.name ?? "Training plan")}
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {activePlan && (
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Delete training plan"
                  title="Delete training plan"
                  onClick={() => setPlanToDelete(activePlan)}
                >
                  🗑
                </button>
              )}
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
          </div>

          <div className="week-grid history-scroll">
            <div className="history-header" aria-hidden="true">
              <div />
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
                <div key={day}>{day}</div>
              ))}
            </div>
            {displayedWeekly.map((week) => (
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
                              } ${
                                workout.source === "plan" && !workout.completed
                                  ? "planned"
                                  : ""
                              }`}
                              aria-pressed={selectedWorkout?.id === workout.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedWorkout(workout);
                              }}
                            >
                              <div
                                className={`workout-pill ${
                                  workout.source === "plan" &&
                                  !workout.completed
                                    ? "planned"
                                    : ""
                                }`}
                              >
                                {workout.type}
                                {workout.source === "plan" &&
                                  !workout.completed &&
                                  " · planned"}
                              </div>
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
                        <option value="threshold">Threshold</option>
                        <option value="interval">Interval</option>
                        <option value="vo2max">VO2max</option>
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
                      <div className="label">Avg pace</div>
                      <div className="value">
                        {formatPace(
                          selectedWorkout.durationMinutes,
                          selectedWorkout.distanceKm,
                        )}
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

        {planToDelete && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setPlanToDelete(null);
              }
            }}
          >
            <section
              className="modal confirmation-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-plan-title"
            >
              <div className="modal-header">
                <h2 id="delete-plan-title">Delete training plan?</h2>
                <button
                  className="modal-close"
                  type="button"
                  aria-label="Close delete plan dialog"
                  onClick={() => setPlanToDelete(null)}
                >
                  ×
                </button>
              </div>
              <p className="confirmation-copy">
                Are you sure you want to delete “{planToDelete.name}” and all of
                its planned workouts? This action cannot be undone.
              </p>
              <div className="confirmation-actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setPlanToDelete(null)}
                >
                  Cancel
                </button>
                <button
                  className="button danger"
                  type="button"
                  onClick={onDeletePlan}
                >
                  Delete plan
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
                      <option value="threshold">Threshold</option>
                      <option value="interval">Interval</option>
                      <option value="vo2max">VO2max</option>
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

        {isPlanModalOpen && (
          <div
            className="modal-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setIsPlanModalOpen(false);
              }
            }}
          >
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="plan-title"
            >
              <div className="modal-header">
                <h2 id="plan-title">Create training plan</h2>
                <button
                  className="modal-close"
                  type="button"
                  aria-label="Close training plan dialog"
                  onClick={() => setIsPlanModalOpen(false)}
                >
                  ×
                </button>
              </div>
              <div className="form-grid">
                <label className="field-label">
                  Start date (optional)
                  <input
                    className="input"
                    type="date"
                    value={planForm.startDate}
                    onChange={(event) =>
                      setPlanForm((prev) => ({
                        ...prev,
                        startDate: event.target.value,
                      }))
                    }
                  />
                  <span style={{ fontWeight: 400 }}>
                    Leave blank to start today.
                  </span>
                </label>

                <fieldset className="coach-filter">
                  <legend>Recent performance (optional)</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={planForm.hasRecentRace}
                      onChange={(event) =>
                        setPlanForm((prev) => ({
                          ...prev,
                          hasRecentRace: event.target.checked,
                        }))
                      }
                    />
                    I have a recent race result to base paces on
                  </label>
                  <span style={{ fontWeight: 400 }}>
                    Training paces are calculated with the VDOT method from this
                    result. Without one, a moderate default fitness level is
                    assumed.
                  </span>
                  {planForm.hasRecentRace && (
                    <div className="form-row form-row-three">
                      <label className="field-label">
                        Distance
                        <select
                          className="select"
                          value={planForm.recentRaceDistancePreset}
                          onChange={(event) => {
                            const preset = raceDistancePresets.find(
                              (item) => item.value === event.target.value,
                            );
                            setPlanForm((prev) => ({
                              ...prev,
                              recentRaceDistancePreset: event.target.value,
                              recentRaceDistanceKm:
                                preset?.km ?? prev.recentRaceDistanceKm,
                            }));
                          }}
                        >
                          {raceDistancePresets.map((preset) => (
                            <option key={preset.value} value={preset.value}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      {planForm.recentRaceDistancePreset === "custom" && (
                        <label className="field-label">
                          Custom distance (km)
                          <input
                            className="input"
                            type="number"
                            min="0"
                            step="0.1"
                            value={planForm.recentRaceDistanceKm}
                            onChange={(event) =>
                              setPlanForm((prev) => ({
                                ...prev,
                                recentRaceDistanceKm: Number(
                                  event.target.value,
                                ),
                              }))
                            }
                          />
                        </label>
                      )}
                      <label className="field-label">
                        Hours
                        <input
                          className="input"
                          type="number"
                          min="0"
                          value={planForm.recentRaceHours}
                          onChange={(event) =>
                            setPlanForm((prev) => ({
                              ...prev,
                              recentRaceHours: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        Minutes
                        <input
                          className="input"
                          type="number"
                          min="0"
                          max="59"
                          value={planForm.recentRaceMinutes}
                          onChange={(event) =>
                            setPlanForm((prev) => ({
                              ...prev,
                              recentRaceMinutes: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        Seconds
                        <input
                          className="input"
                          type="number"
                          min="0"
                          max="59"
                          value={planForm.recentRaceSeconds}
                          onChange={(event) =>
                            setPlanForm((prev) => ({
                              ...prev,
                              recentRaceSeconds: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                  )}
                </fieldset>

                <fieldset className="coach-filter">
                  <legend>Goal type</legend>
                  <label>
                    <input
                      type="radio"
                      name="plan-goal-type"
                      checked={planForm.goalType === "precise"}
                      onChange={() =>
                        setPlanForm((prev) => ({
                          ...prev,
                          goalType: "precise",
                        }))
                      }
                    />
                    Precise goal (a specific race, date and time)
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="plan-goal-type"
                      checked={planForm.goalType === "general"}
                      onChange={() =>
                        setPlanForm((prev) => ({
                          ...prev,
                          goalType: "general",
                        }))
                      }
                    />
                    General goal (no specific race)
                  </label>
                </fieldset>

                {planForm.goalType === "precise" ? (
                  <>
                    <label className="field-label">
                      Race name
                      <input
                        className="input"
                        value={planForm.raceName}
                        onChange={(event) =>
                          setPlanForm((prev) => ({
                            ...prev,
                            raceName: event.target.value,
                          }))
                        }
                        placeholder="e.g. City 10K"
                      />
                    </label>
                    <div className="form-row">
                      <label className="field-label">
                        Race date
                        <input
                          className="input"
                          type="date"
                          value={planForm.raceDate}
                          onChange={(event) =>
                            setPlanForm((prev) => ({
                              ...prev,
                              raceDate: event.target.value,
                            }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        Distance
                        <select
                          className="select"
                          value={planForm.raceDistancePreset}
                          onChange={(event) => {
                            const preset = raceDistancePresets.find(
                              (item) => item.value === event.target.value,
                            );
                            setPlanForm((prev) => ({
                              ...prev,
                              raceDistancePreset: event.target.value,
                              raceDistanceKm: preset?.km ?? prev.raceDistanceKm,
                            }));
                          }}
                        >
                          {raceDistancePresets.map((preset) => (
                            <option key={preset.value} value={preset.value}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {planForm.raceDistancePreset === "custom" && (
                      <label className="field-label">
                        Custom distance (km)
                        <input
                          className="input"
                          type="number"
                          min="0"
                          step="0.1"
                          value={planForm.raceDistanceKm}
                          onChange={(event) =>
                            setPlanForm((prev) => ({
                              ...prev,
                              raceDistanceKm: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    )}
                    <div className="form-row form-row-three">
                      <label className="field-label">
                        Target hours
                        <input
                          className="input"
                          type="number"
                          min="0"
                          value={planForm.goalHours}
                          onChange={(event) =>
                            setPlanForm((prev) => ({
                              ...prev,
                              goalHours: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        Target minutes
                        <input
                          className="input"
                          type="number"
                          min="0"
                          max="59"
                          value={planForm.goalMinutes}
                          onChange={(event) =>
                            setPlanForm((prev) => ({
                              ...prev,
                              goalMinutes: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label className="field-label">
                        Target seconds
                        <input
                          className="input"
                          type="number"
                          min="0"
                          max="59"
                          value={planForm.goalSeconds}
                          onChange={(event) =>
                            setPlanForm((prev) => ({
                              ...prev,
                              goalSeconds: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="field-label">
                      Plan name
                      <input
                        className="input"
                        value={planForm.generalPlanName}
                        onChange={(event) =>
                          setPlanForm((prev) => ({
                            ...prev,
                            generalPlanName: event.target.value,
                          }))
                        }
                        placeholder="e.g. Base building block"
                        required
                      />
                    </label>
                    <label className="field-label">
                      General goal
                      <select
                        className="select"
                        value={planForm.generalGoalCategory}
                        onChange={(event) =>
                          setPlanForm((prev) => ({
                            ...prev,
                            generalGoalCategory: event.target
                              .value as GeneralGoalCategory,
                          }))
                        }
                      >
                        {Object.entries(generalGoalLabels).map(
                          ([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    {planForm.generalGoalCategory === "custom" && (
                      <label className="field-label">
                        Describe your goal
                        <textarea
                          className="textarea"
                          value={planForm.generalGoalDescription}
                          onChange={(event) =>
                            setPlanForm((prev) => ({
                              ...prev,
                              generalGoalDescription: event.target.value,
                            }))
                          }
                          placeholder="What are you working toward?"
                        />
                      </label>
                    )}
                    <label className="field-label">
                      Plan end date
                      <input
                        className="input"
                        type="date"
                        value={planForm.planEndDate}
                        onChange={(event) =>
                          setPlanForm((prev) => ({
                            ...prev,
                            planEndDate: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </>
                )}

                <label className="field-label">
                  Weekly training days
                  <span style={{ fontWeight: 400 }}>
                    Pick the days you can run. Marking a day as "2x" allows an
                    optional second run there when the plan needs the extra
                    volume — it won't add one every week.
                  </span>
                </label>
                <div className="day-picker">
                  {weekdayOptions.map((day) => {
                    const runs = planForm.weeklySchedule[day.value];
                    return (
                      <div
                        key={day.value}
                        className={`day-picker-cell ${runs ? "active" : ""}`}
                      >
                        <button
                          type="button"
                          className="day-picker-toggle"
                          aria-pressed={Boolean(runs)}
                          onClick={() => toggleScheduleDay(day.value)}
                        >
                          {day.label}
                        </button>
                        <button
                          type="button"
                          className={`day-picker-double ${
                            runs === 2 ? "active" : ""
                          }`}
                          disabled={!runs}
                          title="Allow an optional second run on this day when needed"
                          onClick={() =>
                            setScheduleDayRuns(day.value, runs === 2 ? 1 : 2)
                          }
                        >
                          {runs === 2 ? "2x" : "+2x"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                <button
                  className="button"
                  onClick={onCreatePlan}
                  disabled={
                    isPlanSubmitting ||
                    Object.keys(planForm.weeklySchedule).length === 0
                  }
                >
                  {isPlanSubmitting ? "Creating plan..." : "Create plan"}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
