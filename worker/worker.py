import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


API_BASE = os.getenv("API_BASE", "http://api:8091").rstrip("/")
WORKER_TOKEN = os.getenv("WORKER_TOKEN", "")
WORKER_ID = os.getenv("WORKER_ID", "worker-1")
POLL_INTERVAL_SECONDS = float(os.getenv("POLL_INTERVAL_SECONDS", "3"))
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", "/app/storage")).resolve()
ORPHAN_CLEANUP_INTERVAL_SECONDS = float(os.getenv("ORPHAN_CLEANUP_INTERVAL_SECONDS", "3600"))
TMP_MAX_AGE_SECONDS = float(os.getenv("TMP_MAX_AGE_SECONDS", "3600"))
VIDEO_MAX_MB = float(os.getenv("VIDEO_MAX_MB", "18"))
VISION_FRAMES_EVIDENCIA = int(os.getenv("VISION_FRAMES_EVIDENCIA", "6"))
VIDEO_MAX_SEG = int(os.getenv("VIDEO_MAX_SEG", "60"))
VIDEO_REDUCAO_MAX = int(os.getenv("VIDEO_REDUCAO_MAX", "480"))


def log(message, **fields):
    payload = {"message": message, **fields}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def api_post(path, payload):
    data = json.dumps(payload).encode("utf-8")
    request = Request(
        f"{API_BASE}{path}",
        data=data,
        method="POST",
        headers={
            "content-type": "application/json",
            "x-worker-token": WORKER_TOKEN,
            "x-worker-id": WORKER_ID,
        },
    )

    with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}


def safe_storage_path(relative_path):
    candidate = (STORAGE_DIR / relative_path).resolve()
    if candidate != STORAGE_DIR and STORAGE_DIR not in candidate.parents:
        raise ValueError(f"caminho fora do storage: {relative_path}")
    return candidate


def video_duration_seconds(input_path):
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(input_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        stderr = result.stderr.strip() or "ffprobe nao reconheceu o arquivo como video"
        raise ValueError(f"video invalido: {stderr}")

    try:
        duration = float(result.stdout.strip())
    except ValueError as error:
        raise ValueError("video invalido: duracao nao identificada pelo ffprobe") from error

    if duration <= 0:
        raise ValueError("video invalido: duracao menor ou igual a zero")

    return duration


def run_command(command):
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        stderr = result.stderr.strip() or "ffmpeg falhou sem mensagem"
        raise RuntimeError(stderr[-2000:])


def extract_evidence_frames(job, duration):
    origem = safe_storage_path(job["origem"])
    destino_relativo = job["destino_dir"]
    destino = safe_storage_path(destino_relativo)
    tmp_destino = destino.with_name(f"{destino.name}.tmp-{WORKER_ID}")

    if not origem.exists():
        raise FileNotFoundError(f"arquivo de origem nao encontrado: {job['origem']}")

    fps = max(VISION_FRAMES_EVIDENCIA / duration, 0.01)
    largura = 768

    if tmp_destino.exists():
        shutil.rmtree(tmp_destino)

    tmp_destino.mkdir(parents=True, exist_ok=True)

    output_pattern = tmp_destino / "frame_%03d.jpg"
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(origem),
        "-vf",
        f"fps={fps},scale={largura}:-1",
        "-frames:v",
        str(VISION_FRAMES_EVIDENCIA),
        "-q:v",
        "3",
        str(output_pattern),
    ]

    run_command(command)

    frames = sorted(tmp_destino.glob("frame_*.jpg"))
    if not frames:
        raise RuntimeError("ffmpeg nao gerou nenhum frame")

    if destino.exists():
        shutil.rmtree(destino)

    tmp_destino.rename(destino)

    return [
        str(Path(destino_relativo) / frame.name).replace("\\", "/")
        for frame in sorted(destino.glob("frame_*.jpg"))
    ]


def transcode_video(origem, destino, height, max_seconds=None, crf=28):
    destino.parent.mkdir(parents=True, exist_ok=True)
    filtro = f"scale=-2:min({height}\\,ih)"
    command = ["ffmpeg", "-y", "-i", str(origem)]

    if max_seconds:
      command.extend(["-t", str(max_seconds)])

    command.extend([
        "-vf",
        filtro,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        str(crf),
        "-movflags",
        "+faststart",
        str(destino),
    ])

    run_command(command)


def prepare_analysis_video(job, duration):
    origem = safe_storage_path(job["origem"])
    ocorrencia_dir = Path(job["destino_dir"]).name
    destino_relativo = Path("videos") / ocorrencia_dir / "analise.mp4"
    destino = safe_storage_path(destino_relativo)
    tmp_destino = destino.with_suffix(f".tmp-{WORKER_ID}.mp4")
    max_bytes = int(VIDEO_MAX_MB * 1024 * 1024)

    if destino.parent.exists():
        shutil.rmtree(destino.parent)
    destino.parent.mkdir(parents=True, exist_ok=True)

    if origem.suffix.lower() == ".mp4" and origem.stat().st_size <= max_bytes:
        shutil.copy2(origem, destino)
        return str(destino_relativo).replace("\\", "/"), False

    tentativas = [
        {"height": 720, "max_seconds": None, "crf": 28},
        {"height": VIDEO_REDUCAO_MAX, "max_seconds": min(duration, VIDEO_MAX_SEG), "crf": 30},
        {"height": VIDEO_REDUCAO_MAX, "max_seconds": VIDEO_MAX_SEG, "crf": 34},
    ]

    ultimo_truncado = False
    for tentativa in tentativas:
        if tmp_destino.exists():
            tmp_destino.unlink()

        max_seconds = tentativa["max_seconds"]
        ultimo_truncado = bool(max_seconds and duration > max_seconds)
        transcode_video(
            origem,
            tmp_destino,
            tentativa["height"],
            max_seconds=max_seconds,
            crf=tentativa["crf"],
        )

        if tmp_destino.stat().st_size <= max_bytes:
            tmp_destino.rename(destino)
            return str(destino_relativo).replace("\\", "/"), ultimo_truncado

    tmp_destino.unlink(missing_ok=True)
    raise RuntimeError("video excede VIDEO_MAX_MB mesmo apos reducao maxima")


def process_job(job):
    start = time.monotonic()
    frames = []

    try:
        origem = safe_storage_path(job["origem"])
        duration = video_duration_seconds(origem)
        frames = extract_evidence_frames(job, duration)
        video_analise, video_truncado = prepare_analysis_video(job, duration)
        duracao_ms = int((time.monotonic() - start) * 1000)

        api_post(
            "/worker/frame-complete",
            {
                "worker_id": WORKER_ID,
                "job_id": job["id"],
                "success": True,
                "frames": frames,
                "video_analise": video_analise,
                "video_truncado": video_truncado,
                "duracao_ms": duracao_ms,
            },
        )

        log("job concluido", job_id=job["id"], frames=len(frames), video_analise=video_analise, duracao_ms=duracao_ms)
    except Exception as error:
        api_post(
            "/worker/frame-complete",
            {
                "worker_id": WORKER_ID,
                "job_id": job["id"],
                "success": False,
                "frames": frames,
                "erro": str(error),
            },
        )

        log("job falhou", job_id=job["id"], erro=str(error))


def cleanup_temp_dirs():
    frames_dir = STORAGE_DIR / "frames"
    if not frames_dir.exists():
        return

    now = time.time()
    removed = 0

    for item in frames_dir.iterdir():
        if not item.is_dir() or ".tmp-" not in item.name:
            continue

        age = now - item.stat().st_mtime
        if age < TMP_MAX_AGE_SECONDS:
            continue

        shutil.rmtree(item, ignore_errors=True)
        removed += 1

    if removed:
        log("temporarios removidos", count=removed)


def main():
    if not WORKER_TOKEN:
        raise RuntimeError("WORKER_TOKEN obrigatorio")

    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    last_cleanup = 0

    log("worker iniciado", api_base=API_BASE, storage_dir=str(STORAGE_DIR), worker_id=WORKER_ID)

    while True:
        try:
            now = time.monotonic()
            if now - last_cleanup >= ORPHAN_CLEANUP_INTERVAL_SECONDS:
                cleanup_temp_dirs()
                last_cleanup = now

            response = api_post("/worker/frame-claim", {"worker_id": WORKER_ID})
            job = response.get("job")

            if not job:
                time.sleep(POLL_INTERVAL_SECONDS)
                continue

            log("job recebido", job_id=job["id"], ocorrencia_id=job["ocorrencia_id"])
            process_job(job)
        except (HTTPError, URLError) as error:
            log("falha ao chamar api", erro=str(error))
            time.sleep(POLL_INTERVAL_SECONDS)
        except Exception as error:
            log("erro inesperado no loop", erro=str(error))
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
