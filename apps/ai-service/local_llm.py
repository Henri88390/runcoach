from __future__ import annotations

import os
import threading
from pathlib import Path


class LocalCoachModel:
    def __init__(self) -> None:
        self.model_name = os.getenv("LOCAL_MODEL_NAME", "Qwen/Qwen2.5-0.5B-Instruct")
        self.adapter_path = Path(
            os.getenv("LOCAL_ADAPTER_PATH", "models/runcoach-coach-lora")
        )
        self.max_new_tokens = int(os.getenv("LOCAL_LLM_MAX_NEW_TOKENS", "24"))
        self.max_input_tokens = int(os.getenv("LOCAL_LLM_MAX_INPUT_TOKENS", "256"))
        self.cpu_threads = int(os.getenv("LOCAL_LLM_CPU_THREADS", "4"))
        self.allow_cpu = os.getenv("LOCAL_LLM_ON_CPU", "false").lower() == "true"
        self._model = None
        self._tokenizer = None
        self._load_lock = threading.Lock()

    def _load(self) -> None:
        if self._model is not None:
            return

        with self._load_lock:
            if self._model is not None:
                return
            self._load_model()

    def _load_model(self) -> None:

        try:
            import torch
            from transformers import AutoModelForCausalLM, AutoTokenizer
        except ImportError as error:
            raise RuntimeError(
                "Install the local ML dependencies with `pip install -r requirements.txt`."
            ) from error

        if not torch.cuda.is_available() and not self.allow_cpu:
            raise RuntimeError(
                "Local LLM CPU inference is disabled for responsive chat. "
                "Set LOCAL_LLM_ON_CPU=true to enable it explicitly."
            )

        if not torch.cuda.is_available():
            torch.set_num_threads(self.cpu_threads)

        self._tokenizer = AutoTokenizer.from_pretrained(self.model_name)
        self._model = AutoModelForCausalLM.from_pretrained(self.model_name)

        if self.adapter_path.exists():
            from peft import PeftModel

            self._model = PeftModel.from_pretrained(self._model, self.adapter_path)

        self._model.eval()
        self._torch = torch

    def warm_up(self) -> None:
        self._load()

    def answer(self, question: str, context: str) -> str:
        self._load()
        messages = [
            {
                "role": "system",
                "content": (
                    "You are a careful running coach assistant. Answer only from the supplied "
                    "coach notes. Do not copy or quote the notes verbatim. Synthesize them into "
                    "specific, varied, practical advice with a clear recommendation and brief "
                    "reasoning. Do not invent training doctrine or medical advice. Cite claims "
                    "with the supplied source numbers, such as [1]. Avoid repeating the same "
                    "sentence structure across answers. Always return a complete answer in "
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
        prompt = self._tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = self._tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=self.max_input_tokens,
        )
        with self._torch.inference_mode():
            output = self._model.generate(
                **inputs,
                max_new_tokens=self.max_new_tokens,
                do_sample=False,
                pad_token_id=self._tokenizer.eos_token_id,
            )
        generated = output[0][inputs["input_ids"].shape[1] :]
        answer = self._tokenizer.decode(generated, skip_special_tokens=True).strip()
        if len(answer.split()) < 3:
            raise RuntimeError("Local model returned an incomplete answer")
        return answer
