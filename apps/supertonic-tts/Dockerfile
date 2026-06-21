FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/huggingface \
    SUPERTONIC_MODEL_DIR=/models/supertonic

RUN apt-get update \
    && apt-get install -y --no-install-recommends libsndfile1 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/supertonic-tts/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY apps/supertonic-tts/server.py /app/server.py

EXPOSE 5050

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5050"]
