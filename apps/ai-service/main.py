import os
import re
import threading
from queue import Queue
from datetime import date, timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAIError
from pydantic import BaseModel, Field

from knowledge import KnowledgeBase, KnowledgeChunk
from local_llm import LocalCoachModel
from openai_llm import OpenAICoachModel

app = FastAPI(title='RunCoach AI Service')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)


class ChatRequest(BaseModel):
    question: str
    selected_coaches: list[str] = Field(default_factory=list)
    training_history: list[dict] = Field(default_factory=list)
    model_provider: str = "local"


class Source(BaseModel):
    coach: str
    title: str
    url: str


class ChatResponse(BaseModel):
    answer: str
    sources: list[Source]
    generation_mode: str


knowledge_base = KnowledgeBase(os.getenv("COACH_KNOWLEDGE_DB"))
local_model = LocalCoachModel()
openai_model = OpenAICoachModel()
local_llm_timeout_seconds = float(os.getenv("LOCAL_LLM_TIMEOUT_SECONDS", "5"))
openai_timeout_seconds = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "15"))
generation_lock = threading.Lock()
model_status = {"status": "loading", "error": None}


@app.on_event("startup")
def warm_local_model() -> None:
    def load() -> None:
        try:
            local_model.warm_up()
            model_status["status"] = "ready"
            print("Local coach model loaded and ready")
        except (ImportError, OSError, RuntimeError) as error:
            model_status["status"] = "error"
            model_status["error"] = str(error)
            print(f"Local coach model is unavailable; fallback remains active: {error}")

    threading.Thread(target=load, daemon=True).start()


@app.get('/health')
def health():
    return {'ok': True}


@app.get('/model-status')
def model_status_endpoint():
    return {
        "status": model_status["status"],
        "error": model_status["error"],
        "model": local_model.model_name,
        "adapter_path": str(local_model.adapter_path),
    }


@app.get('/coaches', response_model=list[str])
def coaches():
    return knowledge_base.coaches()


@app.get('/providers')
def providers():
    return [
        {
            "id": "local",
            "label": "Local model",
            "available": model_status["status"] == "ready",
        },
        {
            "id": "openai",
            "label": "OpenAI",
            "available": openai_model.is_configured,
        },
    ]


@app.post('/chat', response_model=ChatResponse)
def chat(request: ChatRequest):
    chunks = knowledge_base.retrieve(request.question, request.selected_coaches)
    if not chunks:
        return ChatResponse(
            answer="I could not find coach guidance for that selection. Choose at least one coach and try again.",
            sources=[],
            generation_mode="knowledge_fallback",
        )

    provider = "openai" if request.model_provider == "openai" else "local"

    try:
        answer = answer_with_timeout(
            request.question, chunks, request.training_history, provider=provider
        )
        generation_mode = "openai" if provider == "openai" else "local_llm"
    except TimeoutError as error:
        print(f"{provider} model exceeded its timeout; using fallback: {error}")
        answer = fallback_answer(request.question, chunks, request.training_history)
        generation_mode = "knowledge_fallback"
    except (ImportError, OSError, RuntimeError, OpenAIError) as error:
        print(f"{provider} model unavailable; using grounded fallback: {error}")
        answer = fallback_answer(request.question, chunks, request.training_history)
        generation_mode = "knowledge_fallback"

    return ChatResponse(
        answer=answer,
        sources=[Source(coach=item.coach, title=item.title, url=item.url) for item in chunks],
        generation_mode=generation_mode,
    )


def answer_with_local_model(
    question: str, chunks: list[KnowledgeChunk], training_history: list[dict]
) -> str:
    context = "\n\n".join(
        f"[{index}] {item.coach} - {item.title}\n{item.content}"
        for index, item in enumerate(chunks, start=1)
    )
    history_context = summarize_training_history(training_history)
    answer = local_model.answer(
        question, f"{context}\n\nRunner training history:\n{history_context}"
    )
    if not is_usable_model_answer(answer):
        raise RuntimeError("Local model returned malformed or low-quality answer")
    return answer


def answer_with_openai_model(
    question: str, chunks: list[KnowledgeChunk], training_history: list[dict]
) -> str:
    context = "\n\n".join(
        f"[{index}] {item.coach} - {item.title}\n{item.content}"
        for index, item in enumerate(chunks, start=1)
    )
    history_context = summarize_training_history(training_history)
    answer = openai_model.answer(
        question, f"{context}\n\nRunner training history:\n{history_context}"
    )
    if not is_usable_model_answer(answer):
        raise RuntimeError("OpenAI model returned malformed or low-quality answer")
    return answer


def answer_with_timeout(
    question: str,
    chunks: list[KnowledgeChunk],
    training_history: list[dict],
    provider: str = "local",
) -> str:
    if not generation_lock.acquire(blocking=False):
        raise TimeoutError("another generation is still running")

    generator = answer_with_openai_model if provider == "openai" else answer_with_local_model
    timeout_seconds = openai_timeout_seconds if provider == "openai" else local_llm_timeout_seconds
    result: Queue[tuple[str, object]] = Queue(maxsize=1)

    def generate() -> None:
        try:
            result.put(("ok", generator(question, chunks, training_history)))
        except Exception as error:
            result.put(("error", error))
        finally:
            generation_lock.release()

    threading.Thread(target=generate, daemon=True).start()
    try:
        status, value = result.get(timeout=timeout_seconds)
    except Exception as error:
        raise TimeoutError("generation timed out") from error
    if status == "error":
        raise value  # type: ignore[misc]
    return str(value)


def fallback_answer(
    question: str, chunks: list[KnowledgeChunk], training_history: list[dict]
) -> str:
    coaches = ", ".join(dict.fromkeys(item.coach for item in chunks))
    normalized_question = question.lower()
    if (
        "balance" in normalized_question
        or ("easy" in normalized_question and "hard" in normalized_question)
    ):
        efforts = [
            str(item.get("effort", "")).lower() for item in training_history
        ]
        easy_count = sum(effort in {"easy", "recovery"} for effort in efforts)
        hard_count = sum(effort == "hard" for effort in efforts)
        total_count = easy_count + hard_count
        if total_count:
            easy_share = easy_count / total_count * 100
            advice = (
                f"In the recorded history, {easy_count} of {total_count} workouts are "
                f"easy or recovery and {hard_count} are hard, so the easy share is "
                f"about {easy_share:.0f}%. A sensible balance is to keep most running "
                "easy, separate hard sessions with recovery, and avoid adding another "
                "quality day if fatigue is accumulating. Use this ratio as a guide, not "
                "a rigid rule, because duration and weekly volume also matter."
            )
        else:
            advice = (
                "Your history does not label enough workouts by effort to judge the balance. "
                "In general, keep most running easy, use only a small number of demanding "
                "sessions, and place recovery between them."
            )
    elif "kilometer" in normalized_question or "kilomet" in normalized_question or "km" in normalized_question:
        weekly_totals = recent_weekly_totals(training_history)
        if weekly_totals:
            baseline = sum(weekly_totals) / len(weekly_totals)
            target = baseline * 1.05
            advice = (
                f"Your recent recorded weekly average is {baseline:.1f} km "
                f"({', '.join(f'{value:.1f}' for value in weekly_totals)} km by week). "
                f"For a cautious next week, aim for about {target:.1f} km, keeping the "
                "increase near 5% and reducing it if pain, unusual fatigue, or poor recovery "
                "appears. This is a training-history estimate, not a medical prescription."
            )
        else:
            advice = (
                "There is no single safe weekly distance without training history. Start from "
                "your recent four-week average and increase gradually only when recovery is "
                "good; a coach would need your current mileage and injury history for a precise target."
            )
    elif "recovery" in normalized_question or "fatigue" in normalized_question or "easy" in normalized_question:
        advice = (
            "Keep the next session deliberately comfortable and use effort rather than "
            "a fixed pace. If fatigue is accumulating, shorten the run or replace the "
            "quality session with easy movement. Resume progression only when normal "
            "sleep, mechanics, and motivation return."
        )
    elif "marathon" in question or "specific" in question or "long run" in question:
        advice = (
            "Build the aerobic foundation first, then introduce race-specific work in "
            "small, repeatable doses. Place the long run within the whole week's load "
            "and leave enough recovery to absorb it."
        )
    elif "pace" in question or "intensity" in question or "quality" in question:
        advice = (
            "Choose an intensity that matches the session's purpose and can be repeated "
            "with controlled form. Treat pace as a guide, adjust for conditions, and "
            "stop chasing the number when the intended effort is no longer sustainable."
        )
    else:
        advice = (
            "Favor consistent aerobic training, add demanding work progressively, and "
            "protect recovery between key sessions. The right adjustment depends on "
            "current fitness, recent load, and how well you are recovering."
        )
    citations = " ".join(f"[{index}]" for index, _ in enumerate(chunks[:3], start=1))
    return f"A practical synthesis of {coaches} is: {advice} {citations}"


def is_usable_model_answer(answer: str) -> bool:
    stripped = answer.strip()
    if len(stripped.split()) < 3:
        return False
    if "http://" in stripped or "https://" in stripped:
        return False
    if "[[" in stripped or "]]" in stripped or "](" in stripped:
        return False
    if '""' in stripped or stripped.endswith("\""):
        return False
    return bool(re.search(r"[.!?\]]$", stripped))


def summarize_training_history(training_history: list[dict]) -> str:
    totals = recent_weekly_totals(training_history)
    if not totals:
        return "No recent workout history was provided. Do not invent a mileage baseline."
    workouts = ", ".join(
        f"{item.get('date')}: {float(item.get('distanceKm') or 0):.1f} km"
        for item in training_history[:28]
    )
    return (
        f"Weekly totals for the recent recorded weeks: {', '.join(f'{value:.1f} km' for value in totals)}. "
        f"Workout records: {workouts}"
    )


def recent_weekly_totals(training_history: list[dict]) -> list[float]:
    today = date.today()
    weeks: dict[str, float] = {}
    for workout in training_history:
        try:
            workout_date = date.fromisoformat(str(workout.get("date")))
            if workout_date < today - timedelta(days=27) or workout_date > today:
                continue
            monday = workout_date - timedelta(days=workout_date.weekday())
            weeks[monday.isoformat()] = weeks.get(monday.isoformat(), 0) + float(
                workout.get("distanceKm") or 0
            )
        except (TypeError, ValueError):
            continue
    return [weeks[key] for key in sorted(weeks)]
