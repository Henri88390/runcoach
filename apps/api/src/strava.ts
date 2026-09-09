import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { Workout } from "@runcoach/types";
import { upsertImportedWorkout } from "./db.js";

const getEncryptionKey = () =>
  createHash("sha256")
    .update(process.env.STRAVA_TOKEN_ENCRYPTION_KEY ?? "local-development-key")
    .digest();

const encrypt = (value: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
};

const decrypt = (value: string) => {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

type StravaTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number; firstname?: string; lastname?: string };
};

type StravaActivity = {
  id: number;
  name: string;
  type: string;
  sport_type?: string;
  start_date_local: string;
  elapsed_time: number;
  distance: number;
  average_heartrate?: number;
  max_heartrate?: number;
  workout_type?: number;
};

function mapStravaWorkoutType(activity: StravaActivity): Workout["type"] {
  const name = activity.name.toLowerCase();
  if (activity.workout_type === 1 || name.includes("race")) return "race";
  if (activity.workout_type === 2 || name.includes("long run") || name.includes("long")) {
    return "long";
  }
  if (/interval|repeat|fartlek|track|400m|800m|1k\b|hill repeat/.test(name)) {
    return "interval";
  }
  if (/tempo|threshold|progression|cruise/.test(name)) return "tempo";
  if (/recovery|regeneration/.test(name)) return "recovery";
  if (activity.workout_type === 3) return "tempo";
  return "easy";
}

export async function initializeStravaDatabase(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS strava_connections (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      athlete_id TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function saveStravaConnection(
  pool: Pool,
  userId: string,
  tokens: StravaTokenResponse,
) {
  await pool.query(
    `
      INSERT INTO strava_connections
        (user_id, athlete_id, access_token, refresh_token, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id) DO UPDATE SET
        athlete_id = EXCLUDED.athlete_id,
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        expires_at = EXCLUDED.expires_at,
        connected_at = NOW()
    `,
    [
      userId,
      String(tokens.athlete?.id ?? "unknown"),
      encrypt(tokens.access_token),
      encrypt(tokens.refresh_token),
      tokens.expires_at,
    ],
  );
}

async function getConnection(pool: Pool, userId: string) {
  const result = await pool.query<{
    access_token: string;
    refresh_token: string;
    expires_at: string;
  }>(
    "SELECT access_token, refresh_token, expires_at FROM strava_connections WHERE user_id = $1",
    [userId],
  );
  return result.rows[0];
}

async function getAccessToken(pool: Pool, userId: string) {
  const connection = await getConnection(pool, userId);
  if (!connection) return undefined;
  if (Number(connection.expires_at) > Math.floor(Date.now() / 1000) + 60) {
    return decrypt(connection.access_token);
  }

  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID ?? "",
      client_secret: process.env.STRAVA_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: decrypt(connection.refresh_token),
    }),
  });
  if (!response.ok) throw new Error("Strava token refresh failed");
  const tokens = (await response.json()) as StravaTokenResponse;
  await saveStravaConnection(pool, userId, tokens);
  return tokens.access_token;
}

export async function hasStravaConnection(pool: Pool, userId: string) {
  const result = await pool.query(
    "SELECT 1 FROM strava_connections WHERE user_id = $1",
    [userId],
  );
  return result.rowCount === 1;
}

export async function deleteStravaConnection(pool: Pool, userId: string) {
  await pool.query("DELETE FROM strava_connections WHERE user_id = $1", [userId]);
}

export async function syncStravaActivities(pool: Pool, userId: string) {
  const accessToken = await getAccessToken(pool, userId);
  if (!accessToken) throw new Error("Strava account is not connected");

  const response = await fetch(
    "https://www.strava.com/api/v3/athlete/activities?per_page=100",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 401) {
    await deleteStravaConnection(pool, userId);
    throw new Error("Strava authorization expired; reconnect your Strava account");
  }
  if (!response.ok) throw new Error(`Strava activities returned ${response.status}`);
  const activities = (await response.json()) as StravaActivity[];
  let imported = 0;

  for (const activity of activities) {
    const activityType = (activity.sport_type ?? activity.type).toLowerCase();
    if (!activityType.includes("run")) continue;

    const workout: Workout = {
      id: `strava-${userId}-${activity.id}`,
      date: activity.start_date_local.slice(0, 10),
      startTime: activity.start_date_local.slice(11, 16),
      title: activity.name,
      type: mapStravaWorkoutType(activity),
      durationMinutes: Math.max(1, Math.round(activity.elapsed_time / 60)),
      distanceKm: Number((activity.distance / 1000).toFixed(2)),
      averageHeartRate: activity.average_heartrate,
      maxHeartRate: activity.max_heartrate,
      effort: "moderate",
      notes: "Imported from Strava",
      source: "strava",
      completed: true,
      tags: ["strava"],
    };
    await upsertImportedWorkout(workout, userId);
    imported += 1;
  }

  return imported;
}
