from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

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


class ChatResponse(BaseModel):
    answer: str
    sources: list[str]


@app.get('/health')
def health():
    return {'ok': True}


@app.post('/chat', response_model=ChatResponse)
def chat(request: ChatRequest):
    question = request.question.lower()

    if 'interval' in question or 'vo2' in question or 'speed' in question:
        answer = (
            'For interval work, keep the reps controlled and maintain a steady rhythm. '
            'The goal is to produce high quality work without drifting into slow, sloppy effort and '
            'losing form in the final reps.'
        )
        sources = ['Marius Bakken', 'Jack Daniels']
    elif 'long run' in question or 'long' in question:
        answer = (
            'Long runs should feel mostly aerobic and conversational. Build durability through a steady effort, '
            'with only a controlled finish if the legs are feeling strong.'
        )
        sources = ['Renato Canova', 'Marius Bakken']
    elif 'recovery' in question or 'easy' in question:
        answer = (
            'Easy and recovery runs are where aerobic fitness is developed. Keep the effort light, let the body absorb the training, '
            'and avoid turning easy days into disguised hard sessions.'
        )
        sources = ['Jack Daniels', 'Marius Bakken']
    else:
        answer = (
            'A sensible plan is to place the majority of volume in easy running, keep a small number of focused quality sessions, '
            'and allow recovery to be a strategic part of the week. Consistency is more valuable than chasing one maximal workout.'
        )
        sources = ['Renato Canova', 'Jack Daniels']

    return ChatResponse(answer=answer, sources=sources)
