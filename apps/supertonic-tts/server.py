from __future__ import annotations

import io
import os
import threading
import time

import soundfile as sf
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from supertonic import TTS

SUPPORTED_LANGUAGES = {"en", "ko", "es", "pt", "fr"}
DEFAULT_LANGUAGE = os.getenv("SUPERTONIC_LANGUAGE", "ko")
DEFAULT_MODEL = os.getenv("SUPERTONIC_MODEL", "supertonic-2")
DEFAULT_VOICE = os.getenv("SUPERTONIC_VOICE", "F1")
DEFAULT_TOTAL_STEPS = int(os.getenv("SUPERTONIC_TOTAL_STEPS", "5"))
DEFAULT_SPEED = float(os.getenv("SUPERTONIC_SPEED", "1.05"))
DEFAULT_FORMAT = os.getenv("SUPERTONIC_RESPONSE_FORMAT", "wav")
MODEL_DIR = os.getenv("SUPERTONIC_MODEL_DIR") or None
AUTO_DOWNLOAD = os.getenv("SUPERTONIC_AUTO_DOWNLOAD", "true").lower() not in {
    "0",
    "false",
    "no",
    "off",
}
INTRA_THREADS = os.getenv("SUPERTONIC_INTRA_OP_THREADS")
INTER_THREADS = os.getenv("SUPERTONIC_INTER_OP_THREADS")

app = FastAPI(title="Agent Web Manager Supertonic TTS", version="0.1.0")
_tts_lock = threading.Lock()
_tts: TTS | None = None
_style_cache: dict[str, object] = {}
_last_loaded_at: float | None = None


class SpeechRequest(BaseModel):
    model: str | None = Field(default=None)
    input: str | None = Field(default=None)
    text: str | None = Field(default=None)
    voice: str | None = Field(default=None)
    response_format: str | None = Field(default=None)
    format: str | None = Field(default=None)
    speed: float | None = Field(default=None, ge=0.5, le=2.0)
    lang: str | None = Field(default=None)
    language: str | None = Field(default=None)
    total_steps: int | None = Field(default=None, ge=1, le=20)


class Voice(BaseModel):
    name: str
    language: str
    local: bool


def _optional_int(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    return int(value)


def get_tts() -> TTS:
    global _tts, _last_loaded_at
    with _tts_lock:
        if _tts is None:
            started = time.monotonic()
            _tts = TTS(
                model=DEFAULT_MODEL,
                model_dir=MODEL_DIR,
                auto_download=AUTO_DOWNLOAD,
                intra_op_num_threads=_optional_int(INTRA_THREADS),
                inter_op_num_threads=_optional_int(INTER_THREADS),
            )
            _last_loaded_at = time.monotonic() - started
        return _tts


def get_style(voice: str):
    normalized = voice.strip() or DEFAULT_VOICE
    if normalized not in _style_cache:
        _style_cache[normalized] = get_tts().get_voice_style(normalized)
    return _style_cache[normalized]


def normalize_language(value: str | None) -> str:
    lang = (value or DEFAULT_LANGUAGE).strip().lower()
    if lang in {"ko-kr", "ko_kr", "kr", "korean"}:
        return "ko"
    if lang in {"en-us", "en_uk", "english"}:
        return "en"
    if lang not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{value}'. Supported: {sorted(SUPPORTED_LANGUAGES)}",
        )
    return lang


def wav_response(wav, sample_rate: int) -> Response:
    buffer = io.BytesIO()
    audio = wav[0] if getattr(wav, "ndim", 1) == 2 else wav
    sf.write(buffer, audio, sample_rate, format="WAV", subtype="PCM_16")
    return Response(
        content=buffer.getvalue(),
        media_type="audio/wav",
        headers={"x-audio-format": "wav"},
    )


@app.on_event("startup")
def load_model_on_startup() -> None:
    # Load eagerly so /health means the local model is actually ready.
    get_tts()
    get_style(DEFAULT_VOICE)


@app.get("/health")
def health() -> JSONResponse:
    tts = get_tts()
    return JSONResponse(
        {
            "status": "ok",
            "engine": "supertonic",
            "model": tts.model_name,
            "language": DEFAULT_LANGUAGE,
            "voice": DEFAULT_VOICE,
            "sample_rate": tts.sample_rate,
            "loaded_in_seconds": _last_loaded_at,
            "local": True,
        }
    )


@app.get("/v1/models")
def models() -> JSONResponse:
    return JSONResponse(
        {
            "object": "list",
            "data": [
                {
                    "id": DEFAULT_MODEL,
                    "object": "model",
                    "owned_by": "supertone-inc",
                }
            ],
        }
    )


@app.get("/v1/voices")
def voices() -> JSONResponse:
    tts = get_tts()
    return JSONResponse(
        {
            "voices": [
                Voice(name=name, language=DEFAULT_LANGUAGE, local=True).model_dump()
                for name in tts.voice_style_names
            ]
        }
    )


@app.post("/v1/audio/speech")
def speech(request: SpeechRequest) -> Response:
    text = (request.input or request.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text payload is empty.")

    response_format = (request.response_format or request.format or DEFAULT_FORMAT).lower()
    if response_format not in {"wav", "mp3"}:
        raise HTTPException(
            status_code=400,
            detail="Supertonic local TTS currently supports wav output; mp3 requests are returned as wav by the frontend if needed.",
        )

    voice = request.voice or DEFAULT_VOICE
    lang = normalize_language(request.lang or request.language)
    speed = request.speed if request.speed is not None else DEFAULT_SPEED
    total_steps = request.total_steps if request.total_steps is not None else DEFAULT_TOTAL_STEPS

    try:
        tts = get_tts()
        style = get_style(voice)
        wav, _duration = tts.synthesize(
            text,
            voice_style=style,
            lang=lang,
            speed=speed,
            total_steps=total_steps,
        )
        return wav_response(wav, tts.sample_rate)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 - return upstream-compatible API error
        raise HTTPException(status_code=500, detail=str(exc)) from exc
