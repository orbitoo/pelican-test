#!/usr/bin/env bash
# tools/encode.sh
# Encodes a rendered frame sequence (and optional WAV soundtrack) into a 1080p H.264 MP4.
# Usage:
#   FPS=30 EXT=png bash tools/encode.sh frames_dir out/demo.mp4 [audio.wav]

set -euo pipefail

FRAMES_DIR="${1:?Usage: encode.sh <frames_dir> <out.mp4> [audio.wav]}"
OUT_MP4="${2:?Usage: encode.sh <frames_dir> <out.mp4> [audio.wav]}"
AUDIO_WAV="${3:-}"

FPS="${FPS:-30}"
EXT="${EXT:-png}"
CRF="${CRF:-18}"
AUDIO_BITRATE="${AUDIO_BITRATE:-256k}"

mkdir -p "$(dirname "$OUT_MP4")"

if [[ -n "$AUDIO_WAV" && -f "$AUDIO_WAV" ]]; then
  ffmpeg -y -framerate "$FPS" -start_number 0 \
    -i "${FRAMES_DIR}/frame_%06d.${EXT}" \
    -i "$AUDIO_WAV" \
    -c:v libx264 -preset medium -crf "$CRF" -pix_fmt yuv420p \
    -c:a aac -b:a "$AUDIO_BITRATE" -ar 48000 -shortest \
    -movflags +faststart \
    "$OUT_MP4"
else
  ffmpeg -y -framerate "$FPS" -start_number 0 \
    -i "${FRAMES_DIR}/frame_%06d.${EXT}" \
    -c:v libx264 -preset medium -crf "$CRF" -pix_fmt yuv420p \
    -movflags +faststart \
    "$OUT_MP4"
fi

echo "[encode] Wrote $OUT_MP4 (${FPS}fps, CRF=${CRF})"
