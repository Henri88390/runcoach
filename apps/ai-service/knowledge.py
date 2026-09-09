from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class KnowledgeChunk:
    coach: str
    title: str
    url: str
    content: str


COACH_RESOURCES = (
    KnowledgeChunk(
        coach="Jack Daniels",
        title="Daniels' Running Formula, 4th Edition",
        url="https://us.humankinetics.com/products/daniels-running-formula-4th-edition",
        content=(
            "Training should be organized around current ability and purpose. "
            "Easy running supports recovery and aerobic development; quality sessions "
            "should have a clear physiological goal, controlled volume, and enough recovery."
        ),
    ),
    KnowledgeChunk(
        coach="Renato Canova",
        title="Marathon training principles",
        url="https://www.athleticsillustrated.com/renato-canova-marathon-training/",
        content=(
            "Marathon preparation should progress from general aerobic work toward specific "
            "sessions near the demands of the race. Specific pace work is introduced gradually "
            "and should be supported by a broad aerobic base."
        ),
    ),
    KnowledgeChunk(
        coach="Greg McMillan",
        title="McMillan Running training resources",
        url="https://www.mcmillanrunning.com/",
        content=(
            "A sustainable plan balances easy mileage, workouts, long runs, and recovery. "
            "Training paces should be adjusted to the runner's current fitness, and consistency "
            "matters more than forcing a workout on a fatigued day."
        ),
    ),
    KnowledgeChunk(
        coach="Pete Pfitzinger",
        title="Advanced Marathoning, 3rd Edition",
        url="https://us.humankinetics.com/products/advanced-marathoning-3rd-edition",
        content=(
            "Marathon improvement is supported by progressively increasing aerobic volume, "
            "a purposeful long run, marathon-specific work, and recovery between demanding sessions. "
            "The plan should be adapted when fatigue accumulates."
        ),
    ),
    KnowledgeChunk(
        coach="Arthur Lydiard",
        title="Lydiard Foundation training principles",
        url="https://www.lydiardfoundation.org/",
        content=(
            "A strong endurance phase emphasizes substantial relaxed aerobic running before "
            "more intense speed and anaerobic work. Progression should respect adaptation and "
            "avoid turning every run into a hard effort."
        ),
    ),
    KnowledgeChunk(
        coach="Jack Daniels",
        title="Daniels' Running Formula: training intensity",
        url="https://us.humankinetics.com/products/daniels-running-formula-4th-edition",
        content=(
            "Quality sessions work best when intensity matches the intended system. "
            "Choose a repeatable pace, stop before mechanics deteriorate, and protect the "
            "next easy day rather than turning every workout into a test."
        ),
    ),
    KnowledgeChunk(
        coach="Jack Daniels",
        title="Daniels' Running Formula: training load",
        url="https://us.humankinetics.com/products/daniels-running-formula-4th-edition",
        content=(
            "Training load should rise in a controlled way. Use current performance and "
            "recent consistency to set paces, then adjust for heat, hills, fatigue, and "
            "the purpose of the session."
        ),
    ),
    KnowledgeChunk(
        coach="Renato Canova",
        title="Canova: specific endurance",
        url="https://www.athleticsillustrated.com/renato-canova-marathon-training/",
        content=(
            "Specific endurance sessions should resemble the demands of the target race, "
            "but they belong after general preparation. Increase specificity gradually and "
            "keep the total stress compatible with the athlete's current base."
        ),
    ),
    KnowledgeChunk(
        coach="Renato Canova",
        title="Canova: marathon progression",
        url="https://www.athleticsillustrated.com/renato-canova-marathon-training/",
        content=(
            "A marathon progression moves from broad aerobic conditioning toward longer "
            "blocks at or near race demands. The goal is not one heroic workout, but repeated "
            "exposure that improves economy and durability."
        ),
    ),
    KnowledgeChunk(
        coach="Greg McMillan",
        title="McMillan Running: balancing a plan",
        url="https://www.mcmillanrunning.com/",
        content=(
            "A practical week gives easy running enough space around the long run and quality "
            "work. When fatigue rises, reduce the demanding session before sacrificing the "
            "consistency that makes the plan effective."
        ),
    ),
    KnowledgeChunk(
        coach="Greg McMillan",
        title="McMillan Running: pace guidance",
        url="https://www.mcmillanrunning.com/",
        content=(
            "Training pace is a guide, not a contract. Start from current fitness, then use "
            "effort and conditions to keep an easy run easy and a workout controlled."
        ),
    ),
    KnowledgeChunk(
        coach="Pete Pfitzinger",
        title="Advanced Marathoning: long runs",
        url="https://us.humankinetics.com/products/advanced-marathoning-3rd-edition",
        content=(
            "Long runs build marathon durability when they are placed consistently and "
            "supported by recovery. Their pace and length should fit the week's overall load, "
            "not be chosen in isolation."
        ),
    ),
    KnowledgeChunk(
        coach="Pete Pfitzinger",
        title="Advanced Marathoning: recovery",
        url="https://us.humankinetics.com/products/advanced-marathoning-3rd-edition",
        content=(
            "Recovery is part of the training stimulus. Keep easy days genuinely easy, watch "
            "for accumulating fatigue, and adjust volume before fatigue undermines the next "
            "important session."
        ),
    ),
    KnowledgeChunk(
        coach="Arthur Lydiard",
        title="Lydiard Foundation: aerobic base",
        url="https://www.lydiardfoundation.org/",
        content=(
            "Build endurance with a sustained period of relaxed aerobic running before adding "
            "large amounts of speed work. The base phase develops the capacity to absorb later "
            "intensity."
        ),
    ),
    KnowledgeChunk(
        coach="Arthur Lydiard",
        title="Lydiard Foundation: progression",
        url="https://www.lydiardfoundation.org/",
        content=(
            "Progression should move from aerobic volume toward faster work in stages. Keep "
            "the easy effort honest and let adaptation lead the schedule instead of forcing "
            "intensity before the foundation is ready."
        ),
    ),
)


@dataclass(frozen=True)
class RetrievedChunk:
    chunk: KnowledgeChunk
    score: int


class KnowledgeBase:
    def __init__(self, database_path: str | Path | None = None) -> None:
        self.database_path = database_path or Path(__file__).with_name("coach_knowledge.db")
        if self.database_path != ":memory:":
            self.database_path = Path(self.database_path)
            self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._memory_connection = (
            sqlite3.connect(":memory:") if self.database_path == ":memory:" else None
        )
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = self._memory_connection or sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS coach_knowledge (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    coach TEXT NOT NULL,
                    title TEXT NOT NULL,
                    url TEXT NOT NULL,
                    content TEXT NOT NULL,
                    UNIQUE(coach, title, url)
                )
                """
            )
            connection.executemany(
                """
                INSERT OR IGNORE INTO coach_knowledge (coach, title, url, content)
                VALUES (?, ?, ?, ?)
                """,
                [(item.coach, item.title, item.url, item.content) for item in COACH_RESOURCES],
            )

    def coaches(self) -> list[str]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT DISTINCT coach FROM coach_knowledge ORDER BY coach"
            ).fetchall()
        return [str(row["coach"]) for row in rows]

    def retrieve(self, question: str, selected_coaches: list[str], limit: int = 3) -> list[KnowledgeChunk]:
        allowed = set(selected_coaches)
        terms = set(re.findall(r"[a-z0-9]+", question.lower()))
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT coach, title, url, content FROM coach_knowledge"
            ).fetchall()

        scored: list[RetrievedChunk] = []
        for row in rows:
            if row["coach"] not in allowed:
                continue
            searchable = f"{row['title']} {row['content']}".lower()
            score = sum(1 for term in terms if term in searchable)
            scored.append(
                RetrievedChunk(
                    chunk=KnowledgeChunk(
                        coach=str(row["coach"]),
                        title=str(row["title"]),
                        url=str(row["url"]),
                        content=str(row["content"]),
                    ),
                    score=score,
                )
            )

        scored.sort(key=lambda item: (-item.score, item.chunk.coach))
        return [item.chunk for item in scored[:limit]]
