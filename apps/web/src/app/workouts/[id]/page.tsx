import { formatEnglishDate } from "../../../lib/date-format";

async function getWorkout(id: string) {
  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
  const response = await fetch(`${apiBase}/workouts/${id}`, {
    cache: "no-store",
  });
  const payload = await response.json();
  return payload.data;
}

export default async function WorkoutDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const workout = await getWorkout(params.id);

  if (!workout) {
    return (
      <main style={{ color: "#e5edf6", padding: 32 }}>Workout not found.</main>
    );
  }

  return (
    <main
      style={{ padding: 40, maxWidth: 900, margin: "0 auto", color: "#e5edf6" }}
    >
      <h1 style={{ marginBottom: 8 }}>{workout.workout.title}</h1>
      <div style={{ color: "#a3b5c9", marginBottom: 24 }}>
        {formatEnglishDate(workout.workout.date)}
        {workout.workout.startTime &&
          ` at ${workout.workout.startTime.slice(0, 5)}`}
      </div>

      <div
        style={{
          display: "grid",
          gap: 18,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        <div style={{ background: "#122338", borderRadius: 16, padding: 18 }}>
          <div style={{ color: "#a3b5c9" }}>Duration</div>
          <strong style={{ fontSize: 24 }}>
            {workout.workout.durationMinutes} min
          </strong>
        </div>
        <div style={{ background: "#122338", borderRadius: 16, padding: 18 }}>
          <div style={{ color: "#a3b5c9" }}>Distance</div>
          <strong style={{ fontSize: 24 }}>
            {workout.workout.distanceKm ?? 0} km
          </strong>
        </div>
        <div style={{ background: "#122338", borderRadius: 16, padding: 18 }}>
          <div style={{ color: "#a3b5c9" }}>Avg HR</div>
          <strong style={{ fontSize: 24 }}>
            {workout.workout.averageHeartRate ?? "--"} bpm
          </strong>
        </div>
      </div>

      <section
        style={{
          marginTop: 28,
          background: "#122338",
          borderRadius: 18,
          padding: 24,
        }}
      >
        <h2>Coach notes</h2>
        <p style={{ lineHeight: 1.7, color: "#d8e2ef" }}>
          {workout.workout.notes ?? "No notes recorded for this session."}
        </p>
      </section>

      <section
        style={{
          marginTop: 28,
          background: "#122338",
          borderRadius: 18,
          padding: 24,
        }}
      >
        <h2>Recommendations</h2>
        <ul>
          {workout.recommendations.map((item: string) => (
            <li key={item} style={{ marginBottom: 12, color: "#d8e2ef" }}>
              {item}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
