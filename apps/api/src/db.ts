import pg, { type PoolClient } from "pg";
import dotenv from "dotenv";
import type {
  TrainingPlan,
  TrainingPlanRequest,
  Workout,
  WorkoutType,
} from "@runcoach/types";
import { workouts as seedWorkouts } from "./data.js";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://runcoach:runcoach@localhost:5432/runcoach",
});

type WorkoutRow = {
  id: string;
  date: string | Date;
  start_time: string | null;
  title: string;
  type: WorkoutType;
  duration_minutes: number;
  distance_km: number | null;
  average_heart_rate: number | string | null;
  max_heart_rate: number | string | null;
  effort: Workout["effort"];
  notes: string | null;
  source: Workout["source"];
  completed: boolean;
  tags: string[];
  plan_id: string | null;
};

const mapDatabaseDate = (value: string | Date) =>
  value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
    : value.slice(0, 10);

const mapWorkout = (row: WorkoutRow): Workout => ({
  id: row.id,
  date: mapDatabaseDate(row.date),
  startTime: row.start_time ?? undefined,
  title: row.title,
  type: row.type,
  durationMinutes: row.duration_minutes,
  distanceKm: row.distance_km === null ? undefined : Number(row.distance_km),
  averageHeartRate:
    row.average_heart_rate === null
      ? undefined
      : Number(row.average_heart_rate),
  maxHeartRate:
    row.max_heart_rate === null ? undefined : Number(row.max_heart_rate),
  effort: row.effort,
  notes: row.notes ?? undefined,
  source: row.source,
  completed: row.completed,
  tags: row.tags,
  planId: row.plan_id ?? undefined,
});

const insertWorkout = async (
  client: PoolClient,
  workout: Workout,
  userId: string,
) => {
  await client.query(
    `
      INSERT INTO workouts (
        id, user_id, date, start_time, title, type, duration_minutes, distance_km,
        average_heart_rate, max_heart_rate, effort, notes, source,
        completed, tags, plan_id
      )
      VALUES ($1, $2, $3::date, $4::time, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO NOTHING
    `,
    [
      workout.id,
      userId,
      workout.date,
      workout.startTime ?? "07:00",
      workout.title,
      workout.type,
      workout.durationMinutes,
      workout.distanceKm ?? null,
      workout.averageHeartRate ?? null,
      workout.maxHeartRate ?? null,
      workout.effort,
      workout.notes ?? null,
      workout.source,
      workout.completed,
      workout.tags ?? [],
      workout.planId ?? null,
    ],
  );
};

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS workouts (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      start_time TIME,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 0),
      distance_km NUMERIC(8, 2),
      average_heart_rate NUMERIC,
      max_heart_rate NUMERIC,
      effort TEXT NOT NULL,
      notes TEXT,
      source TEXT NOT NULL,
      completed BOOLEAN NOT NULL DEFAULT TRUE,
      tags TEXT[] NOT NULL DEFAULT '{}'
    )
  `);

  await pool.query(
    "ALTER TABLE workouts ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES users(id) ON DELETE CASCADE",
  );

  await pool.query(`
    CREATE TABLE IF NOT EXISTS training_plans (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Training plan',
      goal_type TEXT NOT NULL,
      race_name TEXT,
      race_distance_km NUMERIC(8, 2),
      goal_date DATE NOT NULL,
      start_date DATE,
      goal_time_seconds INTEGER,
      general_goal_category TEXT,
      general_goal_description TEXT,
      selected_coaches TEXT[] NOT NULL DEFAULT '{}',
      weekly_schedule JSONB NOT NULL DEFAULT '{}',
      recent_race_distance_km NUMERIC(8, 2),
      recent_race_time_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await pool.query(
    "ALTER TABLE workouts ADD COLUMN IF NOT EXISTS plan_id TEXT REFERENCES training_plans(id) ON DELETE CASCADE",
  );
  await pool.query(
    "ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Training plan'",
  );
  await pool.query(
    "ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS start_date DATE",
  );
  await pool.query(
    "ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS weekly_schedule JSONB NOT NULL DEFAULT '{}'",
  );
  await pool.query(
    "ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS recent_race_distance_km NUMERIC(8, 2)",
  );
  await pool.query(
    "ALTER TABLE training_plans ADD COLUMN IF NOT EXISTS recent_race_time_seconds INTEGER",
  );

  await pool.query(
    "ALTER TABLE workouts ADD COLUMN IF NOT EXISTS start_time TIME",
  );
  await pool.query(
    "ALTER TABLE workouts ALTER COLUMN average_heart_rate TYPE NUMERIC USING average_heart_rate::numeric",
  );
  await pool.query(
    "ALTER TABLE workouts ALTER COLUMN max_heart_rate TYPE NUMERIC USING max_heart_rate::numeric",
  );
  await pool.query(
    "UPDATE workouts SET start_time = '07:00' WHERE start_time IS NULL",
  );

  const demoUser = await pool.query<{ id: string }>(
    `
      INSERT INTO users (id, email, name)
      VALUES ('demo-user', 'demo@runcoach.local', 'Demo runner')
      ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `,
  );

  await pool.query("UPDATE workouts SET user_id = $1 WHERE user_id IS NULL", [
    demoUser.rows[0].id,
  ]);

  const { rows } = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM workouts WHERE user_id = $1",
    [demoUser.rows[0].id],
  );

  if (rows[0]?.count === "0") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const workout of seedWorkouts) {
        await insertWorkout(client, workout, demoUser.rows[0].id);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function listWorkouts(userId: string) {
  const result = await pool.query<WorkoutRow>(
    "SELECT * FROM workouts WHERE user_id = $1 ORDER BY date DESC, start_time DESC NULLS LAST, id DESC",
    [userId],
  );
  return result.rows.map(mapWorkout);
}

export async function getWorkout(id: string, userId: string) {
  const result = await pool.query<WorkoutRow>(
    "SELECT * FROM workouts WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return result.rows[0] ? mapWorkout(result.rows[0]) : undefined;
}

export async function createWorkout(workout: Workout, userId: string) {
  const client = await pool.connect();
  try {
    await insertWorkout(client, workout, userId);
    const savedWorkout = await getWorkout(workout.id, userId);
    if (!savedWorkout) {
      throw new Error("Workout was not returned after insert");
    }
    return savedWorkout;
  } finally {
    client.release();
  }
}

export async function upsertImportedWorkout(workout: Workout, userId: string) {
  await pool.query(
    `
      INSERT INTO workouts (
        id, user_id, date, start_time, title, type, duration_minutes, distance_km,
        average_heart_rate, max_heart_rate, effort, notes, source,
        completed, tags
      )
      VALUES ($1, $2, $3::date, $4::time, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (id) DO UPDATE SET
        date = EXCLUDED.date,
        start_time = EXCLUDED.start_time,
        title = EXCLUDED.title,
        type = EXCLUDED.type,
        duration_minutes = EXCLUDED.duration_minutes,
        distance_km = EXCLUDED.distance_km,
        average_heart_rate = EXCLUDED.average_heart_rate,
        max_heart_rate = EXCLUDED.max_heart_rate,
        effort = EXCLUDED.effort,
        notes = EXCLUDED.notes,
        tags = EXCLUDED.tags
      WHERE workouts.user_id = EXCLUDED.user_id
    `,
    [
      workout.id,
      userId,
      workout.date,
      workout.startTime ?? "07:00",
      workout.title,
      workout.type,
      workout.durationMinutes,
      workout.distanceKm ?? null,
      workout.averageHeartRate ?? null,
      workout.maxHeartRate ?? null,
      workout.effort,
      workout.notes ?? null,
      workout.source,
      workout.completed,
      workout.tags ?? [],
    ],
  );
}

export async function deleteWorkout(id: string, userId: string) {
  const result = await pool.query(
    "DELETE FROM workouts WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return result.rowCount === 1;
}

export async function updateWorkout(workout: Workout, userId: string) {
  const result = await pool.query<WorkoutRow>(
    `
      UPDATE workouts
      SET date = $2::date,
          start_time = $3::time,
          title = $4,
          type = $5,
          duration_minutes = $6,
          distance_km = $7,
          average_heart_rate = $8,
          effort = $9,
          notes = $10
      WHERE id = $1 AND user_id = $11
      RETURNING *
    `,
    [
      workout.id,
      workout.date,
      workout.startTime ?? null,
      workout.title,
      workout.type,
      workout.durationMinutes,
      workout.distanceKm ?? null,
      workout.averageHeartRate ?? null,
      workout.effort,
      workout.notes ?? null,
      userId,
    ],
  );

  return result.rows[0] ? mapWorkout(result.rows[0]) : undefined;
}

export async function createPlanWorkouts(workouts: Workout[], userId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const workout of workouts) {
      await insertWorkout(client, workout, userId);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type TrainingPlanRow = {
  id: string;
  name: string;
  goal_type: TrainingPlan["goalType"];
  race_name: string | null;
  race_distance_km: number | string | null;
  goal_date: string | Date;
  start_date: string | Date | null;
  goal_time_seconds: number | null;
  general_goal_category: TrainingPlan["generalGoalCategory"] | null;
  general_goal_description: string | null;
  selected_coaches: string[];
  weekly_schedule: TrainingPlan["weeklySchedule"];
  recent_race_distance_km: number | string | null;
  recent_race_time_seconds: number | null;
  status: TrainingPlan["status"];
  error: string | null;
  created_at: string | Date;
};

const mapTrainingPlan = (row: TrainingPlanRow): TrainingPlan => ({
  id: row.id,
  name: row.name,
  goalType: row.goal_type,
  raceName: row.race_name ?? undefined,
  raceDistanceKm:
    row.race_distance_km === null ? undefined : Number(row.race_distance_km),
  goalDate: mapDatabaseDate(row.goal_date),
  startDate: row.start_date
    ? mapDatabaseDate(row.start_date)
    : mapDatabaseDate(row.created_at),
  goalTimeSeconds: row.goal_time_seconds ?? undefined,
  generalGoalCategory: row.general_goal_category ?? undefined,
  generalGoalDescription: row.general_goal_description ?? undefined,
  selectedCoaches: row.selected_coaches,
  weeklySchedule: row.weekly_schedule ?? {},
  recentRaceDistanceKm:
    row.recent_race_distance_km === null
      ? undefined
      : Number(row.recent_race_distance_km),
  recentRaceTimeSeconds: row.recent_race_time_seconds ?? undefined,
  status: row.status,
  error: row.error ?? undefined,
  createdAt:
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : row.created_at,
});

export async function createTrainingPlan(
  request: TrainingPlanRequest,
  userId: string,
) {
  const id = `plan-${Date.now()}-${Math.round(Math.random() * 1000)}`;
  const result = await pool.query<TrainingPlanRow>(
    `
      INSERT INTO training_plans (
        id, user_id, name, goal_type, race_name, race_distance_km, goal_date,
        start_date, goal_time_seconds, general_goal_category,
        general_goal_description, selected_coaches, weekly_schedule,
        recent_race_distance_km, recent_race_time_seconds, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10, $11, $12, $13, $14, $15, 'queued')
      RETURNING *
    `,
    [
      id,
      userId,
      request.name ?? "Training plan",
      request.goalType,
      request.raceName ?? null,
      request.raceDistanceKm ?? null,
      request.goalDate,
      request.startDate ?? null,
      request.goalTimeSeconds ?? null,
      request.generalGoalCategory ?? null,
      request.generalGoalDescription ?? null,
      request.selectedCoaches ?? [],
      JSON.stringify(request.weeklySchedule ?? {}),
      request.recentRaceDistanceKm ?? null,
      request.recentRaceTimeSeconds ?? null,
    ],
  );
  return mapTrainingPlan(result.rows[0]);
}

export async function listTrainingPlans(userId: string) {
  const result = await pool.query<TrainingPlanRow>(
    "SELECT * FROM training_plans WHERE user_id = $1 ORDER BY created_at DESC",
    [userId],
  );
  return result.rows.map(mapTrainingPlan);
}

export async function getTrainingPlan(id: string, userId: string) {
  const result = await pool.query<TrainingPlanRow>(
    "SELECT * FROM training_plans WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return result.rows[0] ? mapTrainingPlan(result.rows[0]) : undefined;
}

export async function updateTrainingPlanStatus(
  id: string,
  userId: string,
  status: TrainingPlan["status"],
  error?: string,
) {
  await pool.query(
    "UPDATE training_plans SET status = $3, error = $4 WHERE id = $1 AND user_id = $2",
    [id, userId, status, error ?? null],
  );
}

export async function deleteTrainingPlan(id: string, userId: string) {
  const result = await pool.query(
    "DELETE FROM training_plans WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  return result.rowCount === 1;
}
