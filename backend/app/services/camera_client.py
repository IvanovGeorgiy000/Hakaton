"""Получение кадров с камер: демо-камеры, снимок по HTTP(S), видеопоток RTSP.

Сервер сам ходит по адресам, которые вводит пользователь, — это классический риск SSRF. Поэтому:
разрешены только схемы http/https/rtsp, запрещены служебные адреса (link-local, метаданные облаков, multicast),
переходы по редиректам выключены, размер ответа и время ожидания ограничены, ответ обязан быть картинкой.
"""

import asyncio
import io
import ipaddress
import logging
import re
import shutil
import time
from dataclasses import dataclass
from urllib.parse import quote

import httpx
from PIL import Image, ImageOps, UnidentifiedImageError

from app.config import ASSETS_DIR, get_settings

settings = get_settings()
log = logging.getLogger("stroykontrol.cameras")

FRAME_SIZE = (1280, 720)  # все кадры приводим к 16:9 — рамки считаются в процентах от такого кадра
# Потолок размера картинки: крошечный PNG 14000×14000 разворачивался в сотни мегабайт памяти. 40 Мп — с запасом для 8K-камер
Image.MAX_IMAGE_PIXELS = 40_000_000
DEFAULT_PORTS = {"http": 80, "https": 443, "rtsp": 554}
_HOST_RE = re.compile(
    r"^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$"
)

# Тесты подменяют транспорт, чтобы «камера» отвечала без настоящей сети
TRANSPORT: httpx.AsyncBaseTransport | None = None


class CameraError(Exception):
    """Ошибка связи с камерой. message — понятная фраза для интерфейса, code — для программной обработки."""

    def __init__(self, message: str, code: str = "unreachable") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass
class CameraAddress:
    scheme: str  # http | https | rtsp
    host: str
    port: int
    path: str = "/"
    username: str | None = None
    password: str | None = None

    def url(self, *, with_credentials: bool = False) -> str:
        host = f"[{self.host}]" if ":" in self.host else self.host
        auth = ""
        if with_credentials and self.username:
            auth = quote(self.username, safe="") + (f":{quote(self.password, safe='')}" if self.password else "") + "@"
        default = DEFAULT_PORTS.get(self.scheme)
        port = "" if self.port == default else f":{self.port}"
        return f"{self.scheme}://{auth}{host}{port}{self.path}"

    @property
    def display(self) -> str:
        """Адрес для интерфейса — без логина и пароля."""
        return self.url()


@dataclass
class ProbeResult:
    ok: bool
    message: str
    code: str = "ok"
    frame: bytes | None = None  # нормализованный JPEG, если кадр удалось получить
    elapsed_ms: int = 0


# ---------- проверка адреса ----------
def validate_address(addr: CameraAddress) -> None:
    if addr.scheme not in DEFAULT_PORTS:
        raise CameraError("Поддерживаются только подключения http, https и rtsp", "bad_scheme")
    if not 1 <= addr.port <= 65535:
        raise CameraError("Порт должен быть числом от 1 до 65535", "bad_port")
    if not addr.path.startswith("/"):
        raise CameraError("Путь должен начинаться с «/»", "bad_path")
    # перевод строки в пути дописал бы свои строки в запрос RTSP к любому узлу сети
    if any(ch < " " or ch == "\x7f" for part in (addr.host, addr.path, addr.username or "", addr.password or "") for ch in part):
        raise CameraError("В адресе камеры есть недопустимые символы", "bad_path")
    try:
        ipaddress.ip_address(addr.host)
    except ValueError:
        if not _HOST_RE.match(addr.host):
            raise CameraError("Адрес камеры должен быть IP-адресом или именем узла, например 192.168.1.64", "bad_host") from None


def _check_ip(ip: str) -> None:
    address = ipaddress.ip_address(ip)
    if address.is_loopback:
        if not settings.allow_loopback_cameras:
            raise CameraError("Адреса этого компьютера (127.0.0.1) запрещены настройками сервера", "forbidden_address")
        return
    if address.is_link_local or address.is_multicast or address.is_unspecified or address.is_reserved:
        raise CameraError("Этот адрес нельзя использовать для камеры", "forbidden_address")


async def ensure_allowed(addr: CameraAddress) -> None:
    validate_address(addr)
    try:
        _check_ip(addr.host)
        return
    except ValueError:
        pass  # это имя узла — проверяем все адреса, в которые оно раскрывается
    try:
        infos = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(addr.host, addr.port), timeout=settings.camera_timeout_s
        )
    except (OSError, TimeoutError):
        raise CameraError(f"Не удалось найти узел «{addr.host}». Проверьте адрес.", "dns") from None
    for info in infos:
        _check_ip(info[4][0])


# ---------- кадр ----------
def normalize_frame(raw: bytes) -> bytes:
    """Любую картинку приводим к JPEG 1280×720. Другие пропорции дополняются полями, а не обрезаются."""
    try:
        with Image.open(io.BytesIO(raw)) as img:
            if img.format == "JPEG" and img.size == FRAME_SIZE and img.mode == "RGB":
                return raw  # уже в нужном виде — не пересжимаем
            frame = ImageOps.pad(img.convert("RGB"), FRAME_SIZE, Image.Resampling.LANCZOS, color=(0, 0, 0))
    # SyntaxError Pillow бросает на битом PNG, DecompressionBombError — на слишком большой картинке
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise CameraError("По этому адресу пришла не картинка. Проверьте путь к снимку.", "not_image") from None
    out = io.BytesIO()
    frame.save(out, "JPEG", quality=84, optimize=True)
    return out.getvalue()


async def normalize_frame_async(raw: bytes) -> bytes:
    """То же в отдельном потоке: разбор и пережатие картинки не останавливают сервер для остальных запросов."""
    return await asyncio.to_thread(normalize_frame, raw)


def _first_jpeg(buffer: bytes) -> bytes | None:
    """Из потока MJPEG вырезаем первый целый кадр."""
    start = buffer.find(b"\xff\xd8")
    end = buffer.find(b"\xff\xd9", start + 2) if start >= 0 else -1
    return buffer[start : end + 2] if end > 0 else None


async def _http_frame(addr: CameraAddress) -> bytes:
    url = addr.url()
    auth_options: list[httpx.Auth | None] = [None]
    if addr.username:
        password = addr.password or ""
        auth_options = [httpx.BasicAuth(addr.username, password), httpx.DigestAuth(addr.username, password)]

    async with httpx.AsyncClient(
        timeout=settings.camera_timeout_s, follow_redirects=False, verify=False, transport=TRANSPORT
    ) as client:  # noqa: S501 — у камер самоподписанные сертификаты
        last_status = 0
        for auth in auth_options:
            try:
                async with client.stream("GET", url, auth=auth, headers={"Accept": "image/*"}) as response:
                    last_status = response.status_code
                    if response.status_code == 401:
                        continue  # пробуем следующий способ авторизации (Basic → Digest)
                    if response.status_code in (301, 302, 303, 307, 308):
                        raise CameraError("Камера перенаправляет на другой адрес. Укажите конечный адрес снимка.", "redirect")
                    if response.status_code == 404:
                        raise CameraError("Камера отвечает, но по этому пути снимка нет (404). Проверьте путь.", "not_found")
                    if response.status_code >= 400:
                        raise CameraError(f"Камера ответила ошибкой {response.status_code}", "http_error")

                    stream = "multipart" in response.headers.get("content-type", "")
                    buffer = b""
                    async for chunk in response.aiter_bytes():
                        buffer += chunk
                        if len(buffer) > settings.max_frame_bytes:
                            raise CameraError("Слишком большой ответ камеры", "too_large")
                        if stream and (frame := _first_jpeg(buffer)):
                            return frame
                    return _first_jpeg(buffer) or buffer
            except httpx.TimeoutException:
                raise CameraError(f"Камера не отвечает по адресу {addr.display}: истекло время ожидания", "timeout") from None
            except httpx.ConnectError:
                raise CameraError(f"Не удалось подключиться к {addr.display}. Проверьте адрес, порт и сеть.", "connect") from None
            except httpx.HTTPError as exc:
                raise CameraError(f"Ошибка связи с камерой: {exc.__class__.__name__}", "network") from None
        if last_status == 401:
            raise CameraError("Камера требует логин и пароль — они не указаны или неверны", "auth")
    raise CameraError("Не удалось получить кадр", "unreachable")


async def _rtsp_options(addr: CameraAddress) -> int:
    """Проверка RTSP без ffmpeg: открываем соединение и отправляем запрос OPTIONS."""
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(addr.host, addr.port), timeout=settings.camera_timeout_s)
    except TimeoutError:
        raise CameraError(f"Камера не отвечает по адресу {addr.display}: истекло время ожидания", "timeout") from None
    except OSError:
        raise CameraError(f"Не удалось подключиться к {addr.display}. Проверьте адрес, порт и сеть.", "connect") from None
    try:
        writer.write(f"OPTIONS {addr.url()} RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: StroyKontrol\r\n\r\n".encode())
        await writer.drain()
        line = await asyncio.wait_for(reader.readline(), timeout=settings.camera_timeout_s)
    except (TimeoutError, OSError, ValueError):  # ValueError — строка длиннее 64 КБ без перевода строки
        raise CameraError("Порт открыт, но устройство не отвечает по протоколу RTSP", "not_rtsp") from None
    finally:
        writer.close()
    match = re.match(rb"RTSP/\d\.\d (\d{3})", line)
    if not match:
        raise CameraError("Порт открыт, но устройство не отвечает по протоколу RTSP", "not_rtsp")
    return int(match.group(1))


async def _rtsp_frame(addr: CameraAddress) -> bytes:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise CameraError(
            "Для получения кадров из видеопотока RTSP на сервере нужен ffmpeg (в Docker-образе он есть)", "no_ffmpeg"
        )
    socket_timeout_us = str(int(settings.camera_timeout_s * 1_000_000))  # ffmpeg считает таймаут в микросекундах
    command = [
        ffmpeg, "-nostdin", "-loglevel", "error", "-rtsp_transport", "tcp", "-timeout", socket_timeout_us,
        "-i", addr.url(with_credentials=True),
        "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "pipe:1",
    ]  # fmt: skip
    process = await asyncio.create_subprocess_exec(*command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=settings.camera_timeout_s * 3)
    except TimeoutError:
        process.kill()
        raise CameraError("Видеопоток не отдал кадр за отведённое время", "timeout") from None
    if process.returncode != 0 or not stdout:
        text = stderr.decode(errors="ignore").strip()
        last_line = text.splitlines()[-1] if text else f"код завершения {process.returncode}"
        log.warning("ffmpeg не получил кадр с %s: %s", addr.display, last_line)
        if "401" in text or "Unauthorized" in text:
            raise CameraError("Камера требует логин и пароль — они не указаны или неверны", "auth")
        if "404" in text:
            raise CameraError("Камера отвечает по RTSP, но потока по этому пути нет (404). Проверьте путь.", "not_found")
        if "Connection refused" in text or "Connection timed out" in text:
            raise CameraError(f"Не удалось подключиться к {addr.display}. Проверьте адрес, порт и сеть.", "connect")
        raise CameraError("Не удалось получить кадр из видеопотока. Проверьте путь к потоку.", "stream_error")
    return stdout


async def grab_address(addr: CameraAddress) -> bytes:
    """Кадр с настоящей камеры по адресу. Возвращает нормализованный JPEG."""
    await ensure_allowed(addr)
    if addr.scheme == "rtsp":
        raw = await _rtsp_frame(addr)
    else:
        # общий срок: камера, отдающая по байту в секунду, иначе держала бы проверку объекта бесконечно
        try:
            raw = await asyncio.wait_for(_http_frame(addr), timeout=settings.camera_timeout_s * 3)
        except TimeoutError:
            raise CameraError(f"Камера не отдала кадр за отведённое время ({addr.display})", "timeout") from None
    return await normalize_frame_async(raw)


async def probe(addr: CameraAddress) -> ProbeResult:
    """Проверка подключения для формы «Добавить камеру»: можно ли достучаться и получить кадр."""
    started = time.perf_counter()

    def done(**kwargs) -> ProbeResult:
        return ProbeResult(elapsed_ms=int((time.perf_counter() - started) * 1000), **kwargs)

    try:
        await ensure_allowed(addr)
        if addr.scheme == "rtsp":
            status = await _rtsp_options(addr)
            if status not in (200, 401):
                return done(ok=False, code="rtsp_error", message=f"Камера ответила по RTSP кодом {status}")
            if not shutil.which("ffmpeg"):
                note = " Камера просит авторизацию — логин и пароль проверятся при получении кадра." if status == 401 else ""
                return done(
                    ok=True,
                    code="rtsp_no_preview",
                    message="Камера отвечает по RTSP. Предпросмотр кадра недоступен: на сервере нет ffmpeg." + note,
                )
        frame = await grab_address(addr)
        return done(ok=True, message="Камера отвечает, кадр получен", frame=frame)
    except CameraError as exc:
        return done(ok=False, message=exc.message, code=exc.code)


def mock_frame(name: str) -> bytes:
    path = ASSETS_DIR / "seed" / f"{name}.jpg"
    if not path.is_file():
        raise CameraError(f"Демонстрационный кадр «{name}» не найден", "mock_missing")
    return path.read_bytes()
