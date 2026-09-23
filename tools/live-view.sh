#!/usr/bin/env bash
# Живое видео с IP-камеры в браузере через mediamtx (WebRTC, задержка ~0.5 c).
#
# Пароль спрашивается прямо здесь и НЕ записывается в файлы и не попадает в историю команд —
# он живёт только в памяти запущенного процесса mediamtx (передаётся через переменную окружения).
#
# Запуск:  bash tools/live-view.sh
# Затем открой в браузере:  http://localhost:8889/cam
# Останов:  Ctrl-C
#
# Параметры можно переопределить переменными окружения перед запуском:
#   CAM_IP=192.168.1.45  CAM_USER=admin  CAM_PATH=/Streaming/Channels/101  bash tools/live-view.sh
# /Streaming/Channels/101 — основной поток Hikvision/HiWatch; /102 — субпоток (легче для сети).
set -euo pipefail

CAM_IP="${CAM_IP:-192.168.1.45}"
CAM_USER="${CAM_USER:-admin}"
CAM_PATH="${CAM_PATH:-/Streaming/Channels/101}"

command -v mediamtx >/dev/null || { echo "Нет mediamtx. Установи: brew install mediamtx"; exit 1; }

read -rsp "Пароль камеры (ввод скрыт): " CAM_PASS; echo
[ -n "$CAM_PASS" ] || { echo "Пароль пустой — выхожу."; exit 1; }

CFG="$(mktemp -t mediamtx-live).yml"
trap 'rm -f "$CFG"' EXIT
cat > "$CFG" <<'YML'
logLevel: info
rtsp: no
rtmp: no
srt: no
webrtc: yes
webrtcAddress: :8889
webrtcAllowOrigin: '*'
hls: yes
hlsAddress: :8888
paths:
  cam:
    rtspTransport: tcp
    sourceOnDemand: no
YML

echo
echo "Камера:  rtsp://${CAM_USER}:***@${CAM_IP}:554${CAM_PATH}"
echo "Смотреть в браузере:  http://localhost:8889/cam"
echo "Остановить:  Ctrl-C"
echo
# Источник (с паролем) передаётся только через окружение процесса, в файл конфига не пишется.
export MTX_PATHS_CAM_SOURCE="rtsp://${CAM_USER}:${CAM_PASS}@${CAM_IP}:554${CAM_PATH}"
exec mediamtx "$CFG"
