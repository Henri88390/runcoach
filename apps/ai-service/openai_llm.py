from __future__ import annotations

import os


class OpenAICoachModel:
    def __init__(self) -> None:
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.model_name = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self.max_output_tokens = int(os.getenv("OPENAI_MAX_OUTPUT_TOKENS", "220"))
        self._client = None

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _load_client(self):
        if self._client is not None:
            return self._client
        if not self.api_key:
            raise RuntimeError(
                "OPENAI_API_KEY is not set; configure it to use the OpenAI provider."
            )
        try:
            from openai import OpenAI
        except ImportError as error:
            raise RuntimeError(
                "Install the OpenAI SDK with `pip install -r requirements.txt`."
            ) from error
        self._client = OpenAI(api_key=self.api_key)
        return self._client

    def answer(self, question: str, context: str) -> str:
        client = self._load_client()
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a careful running coach assistant. Answer only from the supplied "
                    "coach notes. Do not copy or quote the notes verbatim. Synthesize them into "
                    "specific, practical advice with a clear recommendation and brief reasoning. "
                    "Do not invent training doctrine or medical advice. Cite claims with the "
                    "supplied source numbers, such as [1]. Always return a complete answer in "
                    "complete sentences. If the question asks for a quantity, explain what "
                    "information is needed to personalize it and give a cautious progression "
                    "principle rather than an unsupported precise number. Treat workout "
                    "distances as individual runs and explicitly use the provided weekly "
                    "totals when answering weekly mileage questions. Never use one run's "
                    "distance as the weekly target."
                ),
            },
            {
                "role": "user",
                "content": f"Question: {question}\n\nCoach notes:\n{context}",
            },
        ]
        completion = client.chat.completions.create(
            model=self.model_name,
            messages=messages,
            max_tokens=self.max_output_tokens,
            temperature=0.4,
        )
        answer = (completion.choices[0].message.content or "").strip()
        if len(answer.split()) < 3:
            raise RuntimeError("OpenAI model returned an incomplete answer")
        return answer
