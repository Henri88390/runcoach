from __future__ import annotations

import os
import random
from pathlib import Path

from knowledge import KnowledgeBase


def build_examples() -> list[dict[str, str]]:
    knowledge = KnowledgeBase()
    examples: list[dict[str, str]] = []
    prompts = (
        "How should I structure this part of training?",
        "What is the main coaching principle here?",
        "How would you adapt this when I feel fatigued?",
        "What mistake should a runner avoid?",
        "How does this apply to weekly mileage rather than one workout?",
        "What would a cautious next step look like for a developing runner?",
    )
    for coach in knowledge.coaches():
        chunks = knowledge.retrieve("running training recovery long run pace", [coach], limit=20)
        for index, chunk in enumerate(chunks):
            prompt = prompts[index % len(prompts)]
            examples.append(
                {
                    "prompt": (
                        f"You are answering from {coach}'s coaching principles. {prompt} "
                        "Give practical advice in your own words, explain the reasoning, "
                        "and do not copy the source passage."
                    ),
                    "response": (
                        f"Apply this as a decision rule rather than a fixed prescription. "
                        f"{chunk.content} Use the runner's recent workload and recovery to "
                        f"decide how much to do next, and reduce the load if symptoms or "
                        f"unusual fatigue appear. [1]"
                    ),
                }
            )
    random.Random(42).shuffle(examples)
    return examples


def main() -> None:
    try:
        import torch
        from peft import LoraConfig, get_peft_model
        from transformers import (
            AutoModelForCausalLM,
            AutoTokenizer,
            DataCollatorForLanguageModeling,
            Trainer,
            TrainingArguments,
        )
    except ImportError as error:
        raise SystemExit(
            "Install training dependencies first: pip install -r requirements.txt"
        ) from error
    except OSError as error:
        if getattr(error, "winerror", None) == 4551:
            raise SystemExit(
                "Windows Application Control blocked PyTorch's native DLL. "
                "Ask your administrator to allow the .venv\\Lib\\site-packages\\torch\\lib "
                "DLLs, or run training in WSL/Docker/a different approved environment."
            ) from error
        raise

    base_model = os.getenv("LOCAL_MODEL_NAME", "Qwen/Qwen2.5-0.5B-Instruct")
    output_dir = Path(os.getenv("LOCAL_ADAPTER_PATH", "models/runcoach-coach-lora"))
    epochs = float(os.getenv("TRAIN_EPOCHS", "1"))
    max_length = int(os.getenv("TRAIN_MAX_LENGTH", "128"))
    max_examples = int(os.getenv("TRAIN_MAX_EXAMPLES", "20"))
    cpu_threads = int(os.getenv("TRAIN_CPU_THREADS", "4"))
    if not torch.cuda.is_available():
        torch.set_num_threads(cpu_threads)

    tokenizer = AutoTokenizer.from_pretrained(base_model)
    model = AutoModelForCausalLM.from_pretrained(base_model)
    model = get_peft_model(
        model,
        LoraConfig(
            r=8,
            lora_alpha=16,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
        ),
    )

    examples = build_examples()
    if not examples:
        raise SystemExit("No coach knowledge examples were found.")

    if max_examples > 0:
        examples = examples[:max_examples]

    def tokenize(example: dict[str, str]) -> dict[str, list[int]]:
        text = f"Question: {example['prompt']}\nAnswer: {example['response']}"
        return tokenizer(text, truncation=True, max_length=max_length)

    from datasets import Dataset

    dataset = Dataset.from_list(examples).map(tokenize)
    checkpoints = sorted(
        output_dir.glob("checkpoint-*"),
        key=lambda path: int(path.name.removeprefix("checkpoint-")),
    )
    trainer = Trainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=dataset,
        data_collator=DataCollatorForLanguageModeling(tokenizer, mlm=False),
        args=TrainingArguments(
            output_dir=str(output_dir),
            num_train_epochs=epochs,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=1,
            learning_rate=2e-4,
            logging_steps=1,
            save_strategy="epoch",
            report_to=[],
            fp16=torch.cuda.is_available(),
            dataloader_pin_memory=torch.cuda.is_available(),
        ),
    )
    resume_checkpoint = checkpoints[-1] if checkpoints else None
    if resume_checkpoint:
        print(f"Resuming training from {resume_checkpoint}")
    trainer.train(resume_from_checkpoint=str(resume_checkpoint) if resume_checkpoint else None)
    trainer.save_model(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"Saved local coach adapter to {output_dir}")


if __name__ == "__main__":
    main()
