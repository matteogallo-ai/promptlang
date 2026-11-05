# Renders docs/media/demo.gif from demo.tape. vhs needs ttyd and ffmpeg, which its
# image ships; the demo needs Bun and git, added here. The vhs and Bun images are
# pinned by digest; git comes from the Debian archive at build time.
#   docker build -f docs/media/demo.Dockerfile -t promptlang-vhs docs/media
#   docker run --rm -v "$PWD":/vhs promptlang-vhs docs/media/demo.tape
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS bun
FROM ghcr.io/charmbracelet/vhs:v0.12.1@sha256:ea49a6a1c529be83153e88321892b5585964418f0b9055e8c1e0d732194234a3
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN git config --global user.name demo && git config --global user.email demo@example.invalid
