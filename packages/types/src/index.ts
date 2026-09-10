export type WorkoutType =
  | "easy"
  | "tempo"
  | "threshold"
  | "interval"
  | "vo2max"
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
  source: "strava" | "manual" | "plan";
  completed: boolean;
  tags?: string[];
  planId?: string;
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

export interface ChatRequest {
  question: string;
  selectedCoaches: string[];
  trainingHistory?: Workout[];
}

export interface ChatSource {
  coach: string;
  title: string;
  url: string;
}

export interface ChatResponse {
  answer: string;
  sources: ChatSource[];
  generationMode: "knowledge_fallback" | "openai";
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

export type PlanGoalType = "precise" | "general";

export type GeneralGoalCategory =
  | "speed"
  | "endurance"
  | "general"
  | "maintenance"
  | "custom";

export type TrainingPlanStatus = "queued" | "generating" | "ready" | "failed";

export type PlanWeekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** Maps each selected training day to 1 (single run) or 2 (double: two runs that day). */
export type WeeklySchedule = Partial<Record<PlanWeekday, 1 | 2>>;

export interface TrainingPlanRequest {
  name?: string;
  goalType: PlanGoalType;
  goalDate: string;
  startDate?: string;
  raceName?: string;
  raceDistanceKm?: number;
  goalTimeSeconds?: number;
  generalGoalCategory?: GeneralGoalCategory;
  generalGoalDescription?: string;
  selectedCoaches: string[];
  weeklySchedule: WeeklySchedule;
  longRunDay?: PlanWeekday;
  /** 0 favors training volume; 100 favors workout intensity. */
  volumeIntensityBalance?: number;
  /** Average weekly completed distance from the runner's recent history. */
  recentWeeklyDistanceKm?: number;
  /** Recent race result used to compute VDOT-based training paces. */
  recentRaceDistanceKm?: number;
  recentRaceTimeSeconds?: number;
}

export interface TrainingPlan extends TrainingPlanRequest {
  id: string;
  name: string;
  startDate: string;
  status: TrainingPlanStatus;
  error?: string;
  createdAt: string;
}
