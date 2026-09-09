import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
};

const SESSION_COOKIE = "runcoach_session";
const SESSION_DAYS = 30;
const MAGIC_LINK_MINUTES = 15;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const mapUser = (row: UserRow): AuthUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  avatarUrl: row.avatar_url ?? undefined,
});

export async function initializeAuthDatabase(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('magic_link', 'oauth_state')),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
}

export async function findUserBySession(pool: Pool, token?: string) {
  if (!token) return undefined;

  const result = await pool.query<UserRow>(
    `
      SELECT users.id, users.email, users.name, users.avatar_url
      FROM sessions
      JOIN users ON users.id = sessions.user_id
      WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()
    `,
    [hashToken(token)],
  );

  return result.rows[0] ? mapUser(result.rows[0]) : undefined;
}

export async function createUser(
  pool: Pool,
  input: { email: string; name?: string; avatarUrl?: string },
) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const result = await pool.query<UserRow>(
    `
      INSERT INTO users (id, email, name, avatar_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET
        name = COALESCE(NULLIF(users.name, ''), EXCLUDED.name),
        avatar_url = COALESCE(users.avatar_url, EXCLUDED.avatar_url)
      RETURNING id, email, name, avatar_url
    `,
    [
      `user-${randomBytes(12).toString("hex")}`,
      normalizedEmail,
      input.name?.trim() || normalizedEmail.split("@")[0],
      input.avatarUrl ?? null,
    ],
  );
  return mapUser(result.rows[0]);
}

export async function createSession(pool: Pool, userId: string) {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `
      INSERT INTO sessions (token_hash, user_id, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '${SESSION_DAYS} days')
    `,
    [hashToken(token), userId],
  );
  return token;
}

export async function revokeSession(pool: Pool, token?: string) {
  if (token) {
    await pool.query("DELETE FROM sessions WHERE token_hash = $1", [
      hashToken(token),
    ]);
  }
}

export async function createMagicLink(pool: Pool, email: string) {
  const token = randomBytes(32).toString("base64url");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const normalizedEmail = email.trim().toLowerCase();
    await client.query(
      "DELETE FROM auth_tokens WHERE email = $1 AND kind = 'magic_link'",
      [normalizedEmail],
    );
    await client.query(
      `
        INSERT INTO auth_tokens (token_hash, email, kind, expires_at)
        VALUES ($1, $2, 'magic_link', NOW() + INTERVAL '${MAGIC_LINK_MINUTES} minutes')
      `,
      [hashToken(token), normalizedEmail],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return token;
}

export async function consumeMagicLink(pool: Pool, token: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ email: string }>(
      `
        DELETE FROM auth_tokens
        WHERE token_hash = $1 AND kind = 'magic_link' AND expires_at > NOW()
        RETURNING email
      `,
      [hashToken(token)],
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return undefined;
    }

    const user = await client.query<UserRow>(
      `
        INSERT INTO users (id, email, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
        RETURNING id, email, name, avatar_url
      `,
      [
        `user-${randomBytes(12).toString("hex")}`,
        result.rows[0].email,
        result.rows[0].email.split("@")[0],
      ],
    );
    await client.query("COMMIT");
    return mapUser(user.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createOAuthState(pool: Pool) {
  const state = randomBytes(24).toString("base64url");
  await pool.query(
    `
      INSERT INTO auth_tokens (token_hash, email, kind, expires_at)
      VALUES ($1, '', 'oauth_state', NOW() + INTERVAL '10 minutes')
    `,
    [hashToken(state)],
  );
  return state;
}

export async function consumeOAuthState(pool: Pool, state: string) {
  const result = await pool.query(
    `
      DELETE FROM auth_tokens
      WHERE token_hash = $1 AND kind = 'oauth_state' AND expires_at > NOW()
      RETURNING token_hash
    `,
    [hashToken(state)],
  );
  return result.rowCount === 1;
}

export { SESSION_COOKIE };
