import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import dotenv from "dotenv";
import type {
  ApiResponse,
  ChatRequest,
  ChatResponse,
  Workout,
  WorkoutDetails,
} from "@runcoach/types";
import {
  createWorkout,
  deleteWorkout,
  getWorkout,
  initializeDatabase,
  listWorkouts,
  pool,
  updateWorkout,
} from "./db.js";
import {
  consumeMagicLink,
  consumeOAuthState,
  createMagicLink,
  createOAuthState,
  createSession,
  createUser,
  createStravaOAuthState,
  findUserBySession,
  initializeAuthDatabase,
  revokeSession,
  revokeUserSessions,
  SESSION_COOKIE,
  consumeStravaOAuthState,
  type AuthUser,
} from "./auth.js";
import {
  hasStravaConnection,
  initializeStravaDatabase,
  deleteStravaConnection,
  saveStravaConnection,
  syncStravaActivities,
} from "./strava.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(
  cors({
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    credentials: true,
  }),
);
app.use(express.json());

type AuthenticatedRequest = Request & { user?: AuthUser };

const readCookie = (request: Request, name: string) =>
  request.headers.cookie
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key === name)?.[1];

const setSessionCookie = (response: Response, token: string) => {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
};

const clearSessionCookie = (response: Response) => {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  );
};

const authenticate = async (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) => {
  const user = await findUserBySession(
    pool,
    readCookie(request, SESSION_COOKIE),
  );
  if (!user) {
    response
      .status(401)
      .json({ success: false, data: null, message: "Login required" });
    return;
  }
  request.user = user;
  next();
};

app.get("/auth/me", async (request: Request, response: Response) => {
  const user = await findUserBySession(
    pool,
    readCookie(request, SESSION_COOKIE),
  );
  response.json({ success: true, data: user ?? null });
});

app.post("/auth/email/start", async (request: Request, response: Response) => {
  const email = request.body?.email?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    response
      .status(400)
      .json({
        success: false,
        data: null,
        message: "A valid email is required",
      });
    return;
  }

  const token = await createMagicLink(pool, email);
  const verificationUrl = `${process.env.API_PUBLIC_URL ?? `http://localhost:${port}`}/auth/email/verify?token=${encodeURIComponent(token)}`;
  console.log(`Magic link for ${email}: ${verificationUrl}`);
  response.json({
    success: true,
    data: process.env.NODE_ENV === "production" ? null : { verificationUrl },
    message: "Check your email for a sign-in link",
  });
});

app.get("/auth/email/verify", async (request: Request, response: Response) => {
  const token =
    typeof request.query.token === "string" ? request.query.token : "";
  const user = token ? await consumeMagicLink(pool, token) : undefined;
  if (!user) {
    response
      .status(400)
      .json({
        success: false,
        data: null,
        message: "This sign-in link is invalid or expired",
      });
    return;
  }
  await deleteStravaConnection(pool, user.id);
  setSessionCookie(response, await createSession(pool, user.id));
  response.redirect(process.env.WEB_URL ?? "http://localhost:3000");
});

app.get("/auth/google", async (_request: Request, response: Response) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    response.status(503).send("Google OAuth is not configured");
    return;
  }
  const state = await createOAuthState(pool);
  const redirectUri = `${process.env.API_PUBLIC_URL ?? `http://localhost:${port}`}/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
  });
  response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get(
  "/auth/google/callback",
  async (request: Request, response: Response) => {
    const code =
      typeof request.query.code === "string" ? request.query.code : "";
    const state =
      typeof request.query.state === "string" ? request.query.state : "";
    if (!code || !state || !(await consumeOAuthState(pool, state))) {
      response.status(400).send("Invalid Google OAuth response");
      return;
    }

    const redirectUri = `${process.env.API_PUBLIC_URL ?? `http://localhost:${port}`}/auth/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenResponse.ok || !tokens.access_token) {
      response.status(502).send("Google login could not be completed");
      return;
    }
    const profileResponse = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      },
    );
    const profile = (await profileResponse.json()) as {
      email?: string;
      name?: string;
      picture?: string;
    };
    if (!profile.email) {
      response.status(502).send("Google did not return an email address");
      return;
    }
    const user = await createUser(pool, {
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
    });
    await deleteStravaConnection(pool, user.id);
    setSessionCookie(response, await createSession(pool, user.id));
    response.redirect(process.env.WEB_URL ?? "http://localhost:3000");
  },
);

app.post("/auth/logout", async (request: Request, response: Response) => {
  const sessionToken = readCookie(request, SESSION_COOKIE);
  const user = await findUserBySession(pool, sessionToken);
  if (user) {
    await deleteStravaConnection(pool, user.id);
    await revokeUserSessions(pool, user.id);
  } else {
    await revokeSession(pool, sessionToken);
  }
  clearSessionCookie(response);
  response.setHeader("Cache-Control", "no-store");
  response.json({ success: true, data: null });
});

app.get(
  "/strava/connect",
  authenticate,
  async (request: AuthenticatedRequest, response: Response) => {
    if (!process.env.STRAVA_CLIENT_ID || !process.env.STRAVA_CLIENT_SECRET) {
      response.status(503).send("Strava OAuth is not configured");
      return;
    }
    const state = await createStravaOAuthState(pool, request.user!.id);
    const redirectUri = `${process.env.API_PUBLIC_URL ?? `http://localhost:${port}`}/strava/callback`;
    const params = new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      approval_prompt: "force",
      scope: "read,activity:read_all",
      state,
    });
    response.redirect(`https://www.strava.com/oauth/authorize?${params}`);
  },
);

app.get("/strava/callback", async (request: Request, response: Response) => {
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";
  const currentUser = await findUserBySession(
    pool,
    readCookie(request, SESSION_COOKIE),
  );
  const userId =
    state && currentUser
      ? await consumeStravaOAuthState(pool, state, currentUser.id)
      : undefined;
  if (!code || !userId) {
    response.status(400).send("Invalid Strava OAuth response");
    return;
  }

  const redirectUri = `${process.env.API_PUBLIC_URL ?? `http://localhost:${port}`}/strava/callback`;
  const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID ?? "",
      client_secret: process.env.STRAVA_CLIENT_SECRET ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenResponse.ok) {
    response.status(502).send("Strava connection could not be completed");
    return;
  }
  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete?: { id: number };
  };
  await saveStravaConnection(pool, userId, tokens);
  try {
    await syncStravaActivities(pool, userId);
  } catch (error) {
    console.error("Initial Strava synchronization failed:", error);
    await deleteStravaConnection(pool, userId);
    response.redirect(
      `${process.env.WEB_URL ?? "http://localhost:3000"}?strava=error`,
    );
    return;
  }
  response.redirect(`${process.env.WEB_URL ?? "http://localhost:3000"}?strava=connected`);
});

app.get(
  "/strava/status",
  authenticate,
  async (request: AuthenticatedRequest, response: Response) => {
    response.json({
      success: true,
      data: { connected: await hasStravaConnection(pool, request.user!.id) },
    });
  },
);

app.post(
  "/strava/sync",
  authenticate,
  async (request: AuthenticatedRequest, response: Response) => {
    try {
      const imported = await syncStravaActivities(pool, request.user!.id);
      response.json({ success: true, data: { imported }, message: "Strava workouts synchronized" });
    } catch (error) {
      console.error("Failed to synchronize Strava activities:", error);
      const message = error instanceof Error ? error.message : "Strava synchronization failed";
      response.status(502).json({ success: false, data: null, message });
    }
  },
);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.get(
  "/workouts",
  authenticate,
  async (req: AuthenticatedRequest, res: Response<ApiResponse<Workout[]>>) => {
    try {
      res.json({
        success: true,
        data: await listWorkouts(req.user!.id),
        message: "Workout history loaded",
      });
    } catch {
      res.status(500).json({
        success: false,
        data: [],
        message: "Workout history could not be loaded",
      });
    }
  },
);

app.get(
  "/workouts/weekly",
  authenticate,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      res.json({
        success: true,
        data: buildWeeklySummaries(await listWorkouts(req.user!.id)),
        message: "Weekly summaries loaded",
      });
    } catch (error) {
      console.error("Failed to load weekly summaries:", error);
      res.status(500).json({
        success: false,
        data: [],
        message: "Weekly summaries could not be loaded",
      });
    }
  },
);

app.get(
  "/workouts/:id",
  authenticate,
  async (
    req: AuthenticatedRequest & Request<{ id: string }>,
    res: Response<ApiResponse<WorkoutDetails>>,
  ) => {
    const workout = await getWorkout(req.params.id, req.user!.id);

    if (!workout) {
      res.status(404).json({
        success: false,
        data: null as never,
        message: "Workout not found",
      });
      return;
    }

    const details: WorkoutDetails = {
      workout,
      athleteName: "Henri",
      recommendations: [
        "Keep the next aerobic session relaxed and avoid chasing pace.",
        "Use heart rate as the primary guide to manage effort.",
        "Add one mobility block after this week to support recovery.",
      ],
    };

    res.json({
      success: true,
      data: details,
      message: "Workout details loaded",
    });
  },
);

app.delete(
  "/workouts/:id",
  authenticate,
  async (
    req: AuthenticatedRequest & Request<{ id: string }>,
    res: Response,
  ) => {
    try {
      const deleted = await deleteWorkout(req.params.id, req.user!.id);
      if (!deleted) {
        res.status(404).json({
          success: false,
          data: null,
          message: "Workout not found",
        });
        return;
      }

      res.json({
        success: true,
        data: null,
        message: "Workout deleted successfully",
      });
    } catch {
      res.status(500).json({
        success: false,
        data: null,
        message: "Workout could not be deleted",
      });
    }
  },
);

app.put(
  "/workouts/:id",
  authenticate,
  async (
    req: AuthenticatedRequest & Request<{ id: string }, unknown, Workout>,
    res: Response<ApiResponse<Workout>>,
  ) => {
    try {
      const updatedWorkout = await updateWorkout(
        {
          ...req.body,
          id: req.params.id,
        },
        req.user!.id,
      );

      if (!updatedWorkout) {
        res.status(404).json({
          success: false,
          data: null as never,
          message: "Workout not found",
        });
        return;
      }

      res.json({
        success: true,
        data: updatedWorkout,
        message: "Workout updated successfully",
      });
    } catch {
      res.status(500).json({
        success: false,
        data: null as never,
        message: "Workout could not be updated",
      });
    }
  },
);

app.post(
  "/chat",
  authenticate,
  async (
    req: AuthenticatedRequest & Request<unknown, unknown, ChatRequest>,
    res: Response<ApiResponse<ChatResponse>>,
  ) => {
    const question = req.body?.question?.trim();

    if (!question) {
      res.status(400).json({
        success: false,
        data: {
          answer: "Please provide a questions.",
          sources: [],
          generationMode: "knowledge_fallback",
        },
        message: "Question is required",
      });
      return;
    }

    try {
      const trainingHistory = (await listWorkouts(req.user!.id)).slice(0, 28);
      const aiResponse = await fetch(
        `${process.env.AI_SERVICE_URL ?? "http://localhost:8000"}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            selected_coaches: req.body?.selectedCoaches ?? [],
            training_history: trainingHistory,
          }),
        },
      );

      if (!aiResponse.ok) {
        throw new Error(`AI service returned ${aiResponse.status}`);
      }

      const aiAnswer = (await aiResponse.json()) as ChatResponse & {
        generation_mode?: ChatResponse["generationMode"];
      };
      res.json({
        success: true,
        data: {
          answer: aiAnswer.answer,
          sources: aiAnswer.sources,
          generationMode:
            aiAnswer.generationMode ?? aiAnswer.generation_mode ?? "knowledge_fallback",
        },
        message: "Coach answer generated",
      });
    } catch (error) {
      console.error("Failed to call AI service:", error);
      res.status(503).json({
        success: false,
        data: {
          answer: "",
          sources: [],
          generationMode: "knowledge_fallback",
        },
        message: "AI service is unavailable",
      });
    }
  },
);

app.get(
  "/chat/coaches",
  authenticate,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const coachesResponse = await fetch(
        `${process.env.AI_SERVICE_URL ?? "http://localhost:8000"}/coaches`,
      );
      if (!coachesResponse.ok) throw new Error("Coach list request failed");
      res.json({ success: true, data: await coachesResponse.json() });
    } catch (error) {
      console.error("Failed to load coach sources:", error);
      res.status(503).json({
        success: false,
        data: [],
        message: "Coach sources are unavailable",
      });
    }
  },
);

app.post(
  "/workouts",
  authenticate,
  async (
    req: AuthenticatedRequest & Request<unknown, unknown, Workout>,
    res: Response<ApiResponse<Workout>>,
  ) => {
    try {
      const nextWorkout = { ...req.body, id: `manual-${Date.now()}` };
      const savedWorkout = await createWorkout(nextWorkout, req.user!.id);
      res.status(201).json({
        success: true,
        data: savedWorkout,
        message: "Workout added successfully",
      });
    } catch {
      res.status(500).json({
        success: false,
        data: null as never,
        message: "Workout could not be saved",
      });
    }
  },
);

function getMonday(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const day = value.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function getWeekNumber(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const firstDay = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil(
    ((value.getTime() - firstDay.getTime()) / 86400000 +
      firstDay.getUTCDay() +
      1) /
      7,
  );
}

function buildWeeklySummaries(workouts: Workout[]) {
  const weeks = new Map<string, Workout[]>();

  for (const workout of workouts) {
    const weekStart = getMonday(workout.date);
    const entries = weeks.get(weekStart) ?? [];
    entries.push(workout);
    weeks.set(weekStart, entries);
  }

  return [...weeks.entries()]
    .sort(([first], [second]) => second.localeCompare(first))
    .map(([weekStart, weekWorkouts]) => ({
      weekStart,
      weekLabel: `Week ${getWeekNumber(weekStart)}`,
      totalDistanceKm: weekWorkouts.reduce(
        (total, workout) => total + (workout.distanceKm ?? 0),
        0,
      ),
      totalMinutes: weekWorkouts.reduce(
        (total, workout) => total + workout.durationMinutes,
        0,
      ),
      workouts: weekWorkouts.sort((first, second) =>
        second.date.localeCompare(first.date),
      ),
    }));
}

function generateAiAnswer(question: string): ChatResponse {
  const normalized = question.toLowerCase();

  if (
    normalized.includes("interval") ||
    normalized.includes("vo2") ||
    normalized.includes("speed")
  ) {
    return {
      answer:
        "For interval work, keep the reps controlled and maintain a steady rhythm. The classic approach is to stay at a hard but repeatable effort with quality recoveries, and avoid losing form in the final reps. A good range is 6-10 min total of quality work in a session, depending on the athlete and phase of training.",
      sources: [],
      generationMode: "knowledge_fallback",
    };
  }

  if (normalized.includes("long run") || normalized.includes("long")) {
    return {
      answer:
        "Long runs should be mostly aerobic and conversational. The goal is to build durability, not to turn every session into a race. Keep the effort steady and let the final section drift slightly faster only if the legs feel good.",
      sources: [],
      generationMode: "knowledge_fallback",
    };
  }

  if (normalized.includes("recovery") || normalized.includes("easy")) {
    return {
      answer:
        "Easy and recovery runs are where quality aerobic development happens. Stay relaxed, keep the effort low, and let the body absorb the harder work. If pace is slow but effort stays light, the session is doing its job.",
      sources: [],
      generationMode: "knowledge_fallback",
    };
  }

  return {
    answer:
      "A sensible approach is to base the plan on two to three quality sessions per week, keep most mileage easy, and make sure the hard sessions are repeatable. Consistency and recovery matter more than chasing a single maximal workout.",
    sources: [],
    generationMode: "knowledge_fallback",
  };
}

initializeAuthDatabase(pool)
  .then(() => initializeStravaDatabase(pool))
  .then(() => initializeDatabase())
  .then(() => {
    app.listen(port, () => {
      console.log(`RunCoach API running on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error("Could not initialize PostgreSQL:", error);
    process.exit(1);
  });
