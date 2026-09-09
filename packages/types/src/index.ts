export type WorkoutType =
  | "easy"
  | "tempo"
  | "interval"
  | "long"
  | "recovery"
  | "race"
  | "cross-training";

export interface Workout {
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
}

export interface WeeklyWorkoutSummary {
  weekStart: string;
  weekLabel: string;
  totalDistanceKm: number;
  totalMinutes: number;
  workouts: Workout[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export type ModelProvider = "local" | "openai";

export interface ChatRequest {
  question: string;
  selectedCoaches: string[];
  trainingHistory?: Workout[];
  modelProvider?: ModelProvider;
}

export interface ChatSource {
  coach: string;
  title: string;
  url: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  generationMode: "local_llm" | "knowledge_fallback" | "openai";
}

export interface ChatProvider {
  id: ModelProvider;
  label: string;
  available: boolean;
}

export interface WorkoutDetails {
  workout: Workout;
  athleteName: string;
  recommendations: string[];
}

export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}
