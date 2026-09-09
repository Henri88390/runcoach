import type { TrainingPlanRequest } from "@runcoach/types";
import { createPlanWorkouts, updateTrainingPlanStatus } from "./db.js";
import { generatePlanWorkouts } from "./planGenerator.js";

type PlanJob = {
  planId: string;
  userId: string;
  request: TrainingPlanRequest;
};

const jobs: PlanJob[] = [];
let isProcessing = false;

async function processNext(): Promise<void> {
  if (isProcessing) return;
  const job = jobs.shift();
  if (!job) return;

  isProcessing = true;
  try {
    await updateTrainingPlanStatus(job.planId, job.userId, "generating");
    const workouts = generatePlanWorkouts(job.request, job.planId);
    await createPlanWorkouts(workouts, job.userId);
    await updateTrainingPlanStatus(job.planId, job.userId, "ready");
  } catch (error) {
    console.error("Failed to generate training plan:", error);
    await updateTrainingPlanStatus(
      job.planId,
      job.userId,
      "failed",
      error instanceof Error ? error.message : "Plan generation failed",
    );
  } finally {
    isProcessing = false;
    void processNext();
  }
}

/** Lightweight in-process FIFO queue; avoids adding Redis/BullMQ for a single-instance MVP. */
export function enqueuePlanGeneration(job: PlanJob): void {
  jobs.push(job);
  void processNext();
}
