# MontHangar

Make 3D aircraft documentaries with your AI agent. Real 3D aircraft in a night hangar, on a glowing studio stage and in flight over the ocean, clouds or land, with maps, timeline boards, archival photos and film, spec cards, labels and dimension lines, an original score and sound effects. You bring the topic and your voice. Films run 8 minutes or more.

Every frame is rendered by code on your own computer. No image or video generator, no account and no API key.

Stuck, or want to see what others are making? [Join Chris Ife Studio on Skool](https://dub.sh/chrisifestudio).

## What you need

- A Mac or a Windows PC (a recent graphics chip makes renders much faster)
- Claude Code or Codex
- Node 18 or newer: https://nodejs.org
- FFmpeg: Mac `brew install ffmpeg`, Windows `winget install Gyan.FFmpeg`
- uv: Mac `curl -LsSf https://astral.sh/uv/install.sh | sh`, Windows `winget install astral-sh.uv`
- On Windows, Git for Windows (it includes Git Bash): `winget install Git.Git`

Your agent can install all of these for you. It will ask first.

## Install

Open Claude Code or Codex and say:

> Read https://github.com/montorox/monthangar and install the skill for me. Set up anything that's missing.

Restart your agent when it's done.

If a command fails on your computer, tell your agent. It reads the error and fixes it.

### Windows, step by step

1. Install Node, FFmpeg, uv and Git with the `winget` lines above (open "Terminal" from the Start menu and paste them one at a time), then close and reopen Terminal.
2. Open Claude Code or Codex and give it the install sentence above. It runs the setup in Git Bash.
3. If renders are slow or black, tell your agent "MontHangar renders are black" or "slow". It can switch the renderer to software mode.

## Make your first video

Say this to your agent:

> Use MontHangar. Give me five aircraft video ideas with titles, each about one strange thing you can see on the plane.

Pick one. Your agent researches it, writes the script and finds a 3D model with a licence that allows YouTube use. Read the script, then record it on your phone or microphone and drag the audio file into your agent. It builds the film, shows you frames, and renders the final video with music and sound.

Your videos go in `~/MontHangarStudio/projects`, and every aircraft you check once is kept in `~/MontHangarStudio/library` for the next film.

## About the 3D models

MontHangar uses 3D models made by other people, so each one needs a licence that allows commercial use and changes: CC0, public domain, CC BY, CC BY-SA or Sketchfab Standard. Your agent checks the licence before using a model and writes the credit line for your description. NonCommercial and NoDerivatives models are refused.

## For AI agents

Install by copying the `monthangar` folder from this repository into the skills folder of the agent you are running in: `~/.claude/skills/` for Claude Code, and for Codex `~/.agents/skills/` if it exists, otherwise `~/.codex/skills/`. Check that Node, FFmpeg and uv exist (and Git Bash on Windows), and ask before installing what's missing. Then run `bash <skills folder>/monthangar/setup.sh`. On Windows run every command in Git Bash; the `mh` launcher finds the studio's Python in `.venv/Scripts`. Confirm it works with `<skills folder>/monthangar/core/tools/mh check`: it renders one map frame on the GPU and must print `render ok`. If the GPU path fails (black frames, a WebGL error), pass `--software` to `render.mjs` and tell the user renders will be slower. If a command fails on this computer, read the error and fix it, including in the skill's own files, rather than handing it back to the user. Tell the user to restart their agent.

## Licence

MIT. See `LICENSE` and `NOTICE.md`.
