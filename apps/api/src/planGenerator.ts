import type {
  PlanWeekday,
  TrainingPlanRequest,
  WeeklySchedule,
  Workout,
  WorkoutType,
} from "@runcoach/types";

const COACH_STYLES: Record<string, string> = {
  "Jack Daniels":
    "Following Jack Daniels' principles, keep easy days truly easy and hit quality paces precisely.",
  "Renato Canova":
    "Following Renato Canova's approach, build strength through progressive long runs and specific endurance work.",
  "Marius Bakken":
    "Following Marius Bakken's approach, blend consistent volume with sharp interval sessions.",
  "Pfitzinger & Douglas":
    "Following Pfitzinger & Douglas guidance, combine medium-long runs with structured lactate-threshold work.",
};

function coachNote(selectedCoaches: string[]): string {
  const notes = selectedCoaches
    .map((coach) => COACH_STYLES[coach])
    .filter((note): note is string => Boolean(note));
  return notes.length
    ? notes.join(" ")
    : "Based on general endurance coaching principles.";
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(date, offset);
}

/**
 * Jack Daniels' VDOT formulas (Daniels & Gilbert): estimate a runner's current
 * fitness (VDOT) from one recent race result, then derive each training pace
 * as the velocity that elicits the %VDOT effort typical of that zone. This
 * grounds paces in the runner's actual current fitness rather than a flat
 * multiple of the goal race pace (which was unrealistically fast for easy days).
 */
function vo2FromVelocity(velocityMPerMin: number): number {
  return -4.6 + 0.182258 * velocityMPerMin + 0.000104 * velocityMPerMin ** 2;
}

function velocityFromVO2(vo2: number): number {
  const a = 0.000104;
  const b = 0.182258;
  const c = -(4.6 + vo2);
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

function percentVO2FromTimeMinutes(timeMin: number): number {
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * timeMin) +
    0.2989558 * Math.exp(-0.1932605 * timeMin)
  );
}

function calculateVDOT(distanceKm: number, timeSeconds: number): number {
  const timeMin = timeSeconds / 60;
  const velocityMPerMin = (distanceKm * 1000) / timeMin;
  const vo2 = vo2FromVelocity(velocityMPerMin);
  const percentVO2 = percentVO2FromTimeMinutes(timeMin);
  return vo2 / percentVO2;
}

/** Fallback VDOT for a recreational runner when no recent performance is available. */
const DEFAULT_VDOT = 42;

/**
 * Only a demonstrated recent race result is used to compute VDOT. The goal
 * time is aspirational, not proven fitness, so it must never be used as a
 * stand-in for current ability -- doing so previously made every pace
 * (including easy runs) unrealistically fast for anyone with an ambitious goal.
 */
function resolveVdot(request: TrainingPlanRequest): number {
  if (request.recentRaceDistanceKm && request.recentRaceTimeSeconds) {
    return calculateVDOT(
      request.recentRaceDistanceKm,
      request.recentRaceTimeSeconds,
    );
  }
  return DEFAULT_VDOT;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function recommendedWeeklyDistance(
  request: TrainingPlanRequest,
  availableSessions: number,
  currentVdot: number,
): number {
  const goalVdot =
    request.goalType === "precise" &&
    request.raceDistanceKm &&
    request.goalTimeSeconds
      ? calculateVDOT(request.raceDistanceKm, request.goalTimeSeconds)
      : currentVdot;
  const performanceDemand = Math.max(0, currentVdot - 35) * 0.7;
  const ambitionDemand = clamp(goalVdot - currentVdot, 0, 15) * 1.3;
  const raceDemand =
    request.goalType === "precise" ? (request.raceDistanceKm ?? 0) * 0.6 : 6;
  const recommended =
    availableSessions * 5 + performanceDemand + ambitionDemand + raceDemand;

  return Math.round(
    clamp(recommended, availableSessions * 6, availableSessions * 18),
  );
}

/** Approximate %VDOT effort for each training zone (Daniels & Gilbert). */
/**
 * Daniels & Gilbert's %VDOT effort range for each training zone (not a single
 * point). Easy and recovery ranges deliberately favor the slower end so the
 * planned pace does not turn an aerobic day into a moderate workout.
 */
const ZONE_PERCENT_VDOT: Partial<Record<WorkoutType, [number, number]>> = {
  recovery: [0.48, 0.58],
  easy: [0.52, 0.68],
  long: [0.54, 0.7],
  tempo: [0.79, 0.84],
  threshold: [0.86, 0.9],
  vo2max: [0.95, 1],
  interval: [0.95, 1],
  race: [1, 1],
};

const HEART_RATE_TARGETS: Partial<Record<WorkoutType, string>> = {
  recovery: "Zone 1 (50-60% max HR)",
  easy: "Zone 2 (60-70% max HR)",
  long: "Zone 2 (60-70% max HR)",
  tempo: "Zone 3 (70-80% max HR)",
  threshold: "Zone 4 (80-90% max HR)",
  vo2max: "Zone 5 (90-100% max HR)",
  interval: "Zone 5 (90-100% max HR)",
  race: "Zones 4-5 (80-100% max HR)",
};

/** Single representative pace for scheduling: the middle of the zone's %VDOT range. */
function paceSecPerKmFor(type: WorkoutType, vdot: number): number | undefined {
  const range = ZONE_PERCENT_VDOT[type];
  if (!range) return undefined;
  const [low, high] = range;
  const percent = (low + high) / 2;
  const velocityMPerMin = velocityFromVO2(vdot * percent);
  return 60000 / velocityMPerMin;
}

const INTENT_BY_TYPE: Partial<Record<WorkoutType, string>> = {
  easy: "Easy aerobic run to build base fitness without added fatigue.",
  recovery: "Very easy shakeout run to aid recovery between harder sessions.",
  long: "Long aerobic run to build endurance and durability.",
  tempo: "Comfortably hard, sustained effort to raise the aerobic threshold.",
  threshold: "Cruise-interval/threshold work to raise lactate threshold.",
  vo2max: "Short, fast repetitions to raise VO2max and running economy.",
  interval: "Repeated efforts to build speed and lactate tolerance.",
  race: "Race day: execute the goal pace.",
  "cross-training":
    "Low-impact cross-training to maintain fitness while reducing impact.",
};

function formatPace(secPerKm: number): string {
  const totalSeconds = Math.round(secPerKm);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Human-readable target pace range for a session type, e.g. "5:30-5:45/km", fast end first. */
function paceTargetFor(type: WorkoutType, vdot: number): string | undefined {
  const range = ZONE_PERCENT_VDOT[type];
  if (!range) return undefined;
  const [low, high] = range;
  const fast = 60000 / velocityFromVO2(vdot * high);
  const slow = 60000 / velocityFromVO2(vdot * low);
  return fast === slow
    ? `${formatPace(fast)}/km`
    : `${formatPace(fast)}-${formatPace(slow)}/km`;
}

const QUALITY_TYPES = new Set<WorkoutType>([
  "tempo",
  "threshold",
  "vo2max",
  "interval",
]);

/** Precise session structure, e.g. "10 x 400m @ 3:30-3:40/km, 2 min jog recovery". */
function sessionStructureFor(
  type: WorkoutType,
  distanceKm: number,
  durationMinutes: number,
  paceTarget: string | undefined,
): string | undefined {
  if (!paceTarget) return undefined;
  if (type === "vo2max") {
    const reps = Math.max(
      4,
      Math.min(12, Math.round((distanceKm * 1000) / 400)),
    );
    return `${reps} x 400m @ ${paceTarget}, 2 min jog recovery`;
  }
  if (type === "interval") {
    const reps = Math.max(
      4,
      Math.min(10, Math.round((distanceKm * 1000) / 800)),
    );
    return `${reps} x 800m @ ${paceTarget}, 2-3 min jog recovery`;
  }
  if (type === "threshold") {
    const reps = 3;
    const perRepMinutes = Math.max(5, Math.round(durationMinutes / reps));
    return `${reps} x ${perRepMinutes} min @ ${paceTarget}, 90 sec jog recovery`;
  }
  if (type === "tempo") {
    return `${durationMinutes} min continuous @ ${paceTarget}`;
  }
  return undefined;
}

/** Composes phase/intent/pace/structure/coach notes into one readable string. */
function composeNotes(parts: {
  phaseLabel?: string;
  intent?: string;
  paceTarget?: string;
  heartRateTarget?: string;
  structure?: string;
  coachNote: string;
}): string {
  return [
    parts.phaseLabel ? `${parts.phaseLabel} phase.` : undefined,
    parts.intent,
    parts.paceTarget ? `Target pace: ${parts.paceTarget}.` : undefined,
    parts.heartRateTarget ? `Heart rate: ${parts.heartRateTarget}.` : undefined,
    parts.structure ? `Workout: ${parts.structure}.` : undefined,
    parts.coachNote,
  ]
    .filter(Boolean)
    .join(" ");
}

const WEEKDAY_ORDER: PlanWeekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

const WEEKDAY_OFFSET: Record<PlanWeekday, number> = {
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

const DEFAULT_SCHEDULE_DAYS: ScheduleDay[] = [
  { offset: 1, doubles: false },
  { offset: 3, doubles: false },
  { offset: 5, doubles: false },
  { offset: 6, doubles: false },
];

type ScheduleDay = { offset: number; doubles: boolean };

function scheduleOffsets(schedule: WeeklySchedule | undefined): ScheduleDay[] {
  const entries = WEEKDAY_ORDER.filter((day) => schedule?.[day]).map((day) => ({
    offset: WEEKDAY_OFFSET[day],
    doubles: schedule?.[day] === 2,
  }));
  return entries.length > 0 ? entries : DEFAULT_SCHEDULE_DAYS;
}

type Session = {
  offset: number;
  type: WorkoutType;
  shareOfWeek: number;
  effort: Workout["effort"];
  doubles: boolean;
};

function buildOtherSessions(
  otherDays: ScheduleDay[],
  qualityType: WorkoutType,
): Session[] {
  const qualityIndex =
    otherDays.length === 1 ? 0 : Math.floor((otherDays.length - 1) / 2);

  return otherDays.map((day, index) => {
    if (index === qualityIndex) {
      return {
        offset: day.offset,
        type: qualityType,
        shareOfWeek: 0.2,
        effort: "hard",
        doubles: day.doubles,
      };
    }
    if (index === 0 && otherDays.length >= 3) {
      return {
        offset: day.offset,
        type: "recovery",
        shareOfWeek: 0.12,
        effort: "easy",
        doubles: day.doubles,
      };
    }
    return {
      offset: day.offset,
      type: "easy",
      shareOfWeek: 0.16,
      effort: "easy",
      doubles: day.doubles,
    };
  });
}

/**
 * Doubles are marked "eligible" per day, not mandatory: only insert one when
 * the plan actually needs extra volume (build/peak weeks), and only every
 * other such week, so an eligible day doesn't get a double every single week.
 */
function shouldAddDouble(phaseLabel: string, week: number): boolean {
  if (phaseLabel !== "Build" && phaseLabel !== "Peak") return false;
  return week % 2 === 0;
}

/**
 * Deterministic, rule-based periodized plan (base -> build -> peak -> taper).
 * Keeping this rule-based instead of LLM-generated keeps the schedule/dates reliable.
 */
export function generatePlanWorkouts(
  request: TrainingPlanRequest,
  planId: string,
): Workout[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const requestedStart = request.startDate
    ? new Date(`${request.startDate}T00:00:00`)
    : today;
  const effectiveStart = requestedStart < today ? today : requestedStart;
  const goalDate = new Date(`${request.goalDate}T00:00:00`);
  const totalDays = Math.max(
    7,
    Math.round((goalDate.getTime() - effectiveStart.getTime()) / 86_400_000),
  );
  const totalWeeks = Math.max(2, Math.ceil(totalDays / 7));
  const note = coachNote(request.selectedCoaches);
  const vdot = resolveVdot(request);

  const scheduleDays = scheduleOffsets(request.weeklySchedule);
  const availableSessions = scheduleDays.reduce(
    (total, day) => total + (day.doubles ? 2 : 1),
    0,
  );
  const targetWeeklyKm = recommendedWeeklyDistance(
    request,
    availableSessions,
    vdot,
  );
  const startingWeeklyKm = request.recentWeeklyDistanceKm
    ? Math.round(
        clamp(
          request.recentWeeklyDistanceKm,
          Math.max(10, targetWeeklyKm * 0.5),
          targetWeeklyKm * 1.25,
        ),
      )
    : Math.round(targetWeeklyKm * 0.65);
  const longEntry = request.longRunDay
    ? (scheduleDays.find(
        (day) => day.offset === WEEKDAY_OFFSET[request.longRunDay!],
      ) ?? scheduleDays[scheduleDays.length - 1])
    : scheduleDays[scheduleDays.length - 1];
  const otherDays = scheduleDays.filter((day) => day !== longEntry);

  const startMonday = mondayOf(effectiveStart);
  const workouts: Workout[] = [];
  let sessionIndex = 0;

  for (let week = 0; week < totalWeeks; week += 1) {
    const weekStart = addDays(startMonday, week * 7);
    const weeksRemaining = totalWeeks - week;
    const isTaperWeek = weeksRemaining <= 1;
    const isRaceWeek =
      request.goalType === "precise" &&
      goalDate >= weekStart &&
      goalDate < addDays(weekStart, 7);
    const isPeakWeek =
      !isTaperWeek &&
      weeksRemaining <= Math.max(2, Math.round(totalWeeks * 0.2));
    const isBuildWeek =
      !isTaperWeek &&
      !isPeakWeek &&
      weeksRemaining <= Math.max(3, Math.round(totalWeeks * 0.5));

    const progression = Math.min(1, week / Math.max(1, totalWeeks - 2));
    const desiredWeeklyKm =
      startingWeeklyKm + (targetWeeklyKm - startingWeeklyKm) * progression;
    const safeUpperBound = startingWeeklyKm * 1.08 ** week;
    const safeLowerBound = startingWeeklyKm * 0.9 ** week;
    const progressedWeeklyKm = clamp(
      desiredWeeklyKm,
      safeLowerBound,
      safeUpperBound,
    );
    const weeklyKm = Math.max(
      10,
      Math.round(isTaperWeek ? progressedWeeklyKm * 0.6 : progressedWeeklyKm),
    );

    const phaseLabel = isTaperWeek
      ? "Taper"
      : isPeakWeek
        ? "Peak"
        : isBuildWeek
          ? "Build"
          : "Base";

    const qualityType: WorkoutType = isPeakWeek
      ? "vo2max"
      : isBuildWeek
        ? "threshold"
        : "tempo";

    const sessions: Session[] = [
      ...buildOtherSessions(otherDays, qualityType),
      {
        offset: longEntry.offset,
        type: isRaceWeek ? "easy" : "long",
        shareOfWeek: isRaceWeek ? 0.12 : 0.3,
        effort: isRaceWeek ? "easy" : "moderate",
        doubles: isRaceWeek ? false : longEntry.doubles,
      },
    ];

    for (const session of sessions) {
      const date = addDays(weekStart, session.offset);
      if (date < effectiveStart || date >= goalDate) continue;
      const rawDistanceKm = Math.max(
        3,
        Math.round(weeklyKm * session.shareOfWeek * 10) / 10,
      );

      sessionIndex += 1;
      const paceTarget = paceTargetFor(session.type, vdot);
      const heartRateTarget = HEART_RATE_TARGETS[session.type];

      let distanceKm = rawDistanceKm;
      let durationMinutes: number;
      let structure: string | undefined;

      if (QUALITY_TYPES.has(session.type)) {
        // Warmup/cooldown are always run easy (zone 2), regardless of the main set's pace.
        const easyPaceTarget = paceTargetFor("easy", vdot);
        const easyPaceSecPerKm = paceSecPerKmFor("easy", vdot) ?? 400;
        const mainPaceSecPerKm =
          paceSecPerKmFor(session.type, vdot) ?? easyPaceSecPerKm;
        const warmupKm = 2;
        const cooldownKm = 1.5;
        const mainDurationMinutes = Math.max(
          5,
          Math.round((rawDistanceKm * mainPaceSecPerKm) / 60),
        );
        const warmupDurationMinutes = Math.round(
          (warmupKm * easyPaceSecPerKm) / 60,
        );
        const cooldownDurationMinutes = Math.round(
          (cooldownKm * easyPaceSecPerKm) / 60,
        );
        distanceKm =
          Math.round((rawDistanceKm + warmupKm + cooldownKm) * 10) / 10;
        durationMinutes =
          mainDurationMinutes + warmupDurationMinutes + cooldownDurationMinutes;
        const mainStructure = sessionStructureFor(
          session.type,
          rawDistanceKm,
          mainDurationMinutes,
          paceTarget,
        );
        structure = mainStructure
          ? `${warmupDurationMinutes} min easy warmup @ ${easyPaceTarget} (zone 2), ${mainStructure}, ${cooldownDurationMinutes} min easy cooldown @ ${easyPaceTarget} (zone 2)`
          : mainStructure;
      } else {
        const paceSecPerKm =
          paceSecPerKmFor(session.type, vdot) ?? paceSecPerKmFor("easy", vdot)!;
        durationMinutes = Math.max(
          15,
          Math.round((rawDistanceKm * paceSecPerKm) / 60),
        );
      }

      workouts.push({
        id: `plan-${planId}-${sessionIndex}`,
        date: toDateString(date),
        startTime: "07:00",
        title: `${phaseLabel} ${session.type}`,
        type: session.type,
        durationMinutes,
        distanceKm,
        effort: session.effort,
        notes: composeNotes({
          phaseLabel,
          intent: INTENT_BY_TYPE[session.type],
          paceTarget,
          heartRateTarget,
          structure,
          coachNote: note,
        }),
        source: "plan",
        completed: false,
        tags: ["plan", phaseLabel.toLowerCase()],
        planId,
      });

      if (session.doubles && shouldAddDouble(phaseLabel, week)) {
        const doubleDistanceKm = Math.max(
          2,
          Math.round(weeklyKm * 0.08 * 10) / 10,
        );
        const doublePaceSecPerKm = paceSecPerKmFor("recovery", vdot)!;
        const doubleDuration = Math.max(
          15,
          Math.round((doubleDistanceKm * doublePaceSecPerKm) / 60),
        );
        sessionIndex += 1;
        const doublePaceTarget = paceTargetFor("recovery", vdot);
        workouts.push({
          id: `plan-${planId}-${sessionIndex}`,
          date: toDateString(date),
          startTime: "18:00",
          title: `${phaseLabel} recovery double`,
          type: "recovery",
          durationMinutes: doubleDuration,
          distanceKm: doubleDistanceKm,
          effort: "easy",
          notes: composeNotes({
            intent:
              "Second easy shakeout run to add volume without adding another training day.",
            paceTarget: doublePaceTarget,
            heartRateTarget: HEART_RATE_TARGETS.recovery,
            coachNote: note,
          }),
          source: "plan",
          completed: false,
          tags: ["plan", "double"],
          planId,
        });
      }
    }
  }

  sessionIndex += 1;
  const goalPace =
    request.goalType === "precise" &&
    request.raceDistanceKm &&
    request.goalTimeSeconds
      ? formatPace(request.goalTimeSeconds / request.raceDistanceKm) + "/km"
      : undefined;
  workouts.push({
    id: `plan-${planId}-${sessionIndex}`,
    date: request.goalDate,
    startTime: "08:00",
    title: request.raceName ?? "Goal day",
    type: request.goalType === "precise" ? "race" : "long",
    durationMinutes: request.goalTimeSeconds
      ? Math.round(request.goalTimeSeconds / 60)
      : 60,
    distanceKm: request.raceDistanceKm,
    effort: "hard",
    notes: composeNotes({
      intent: `Goal day: ${request.raceName ?? "target goal"}.`,
      paceTarget: goalPace,
      heartRateTarget: HEART_RATE_TARGETS.race,
      coachNote: note,
    }),
    source: "plan",
    completed: false,
    tags: ["plan", "goal-day"],
    planId,
  });

  return workouts.sort((a, b) => a.date.localeCompare(b.date));
}
