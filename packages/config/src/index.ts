export const appConfig = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000",
  aiBaseUrl: process.env.NEXT_PUBLIC_AI_BASE_URL ?? "http://localhost:8000",
  appName: "RunCoach AI",
  coachSources: [
    "Marius Bakken",
    "Renato Canova",
    "Jack Daniels",
    "Pfitzinger & Douglas",
  ],
};
