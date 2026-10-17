#!/usr/bin/env python3
"""Generate the cute UI sound effects with ElevenLabs. Standard library only.
Reads the API key from the macOS Keychain at run time (never stored, never printed).
Usage: python3 scripts/gen-sfx.py [--force] [name ...]"""
import json, subprocess, sys, urllib.request, urllib.error
from pathlib import Path

SOUNDS = {
    "join": ("cheerful tiny welcome chime, soft marimba, two ascending notes, cozy village life-sim game, gentle and cute", 1.2),
    "ping": ("friendly notification, bubbly xylophone, three quick ascending notes, cozy village life-sim game, cute", 1.2),
    "bubble": ("soft cartoon bubble pop with a tiny boop, cute, gentle", 0.8),
    "plant": ("cute wooden plunk then a small sparkle, planting a flag in soft soil, cartoon game", 1.2),
    "mood": ("tiny happy sparkle glissando, harp and bell, cute, very short", 0.8),
    "imin": ("happy two note yay jingle, soft marimba, cozy game, cute", 1.2),
    "talk": ("short rising blip, like a microphone switching on, soft and cute", 0.6),
    "decline": ("gentle soft bonk, polite no, cartoon, not harsh, very short", 0.6),
    "leave": ("soft descending two note goodbye, music box, cozy and cute", 1.4),
}
OUT = Path(__file__).resolve().parent.parent / "public" / "sfx"

def key():
    r = subprocess.run(["security", "find-generic-password", "-s", "ELEVENLABS_API_KEY", "-w"],
                       capture_output=True, text=True, timeout=20)
    if r.returncode != 0 or not r.stdout.strip():
        sys.exit("No ELEVENLABS_API_KEY in the Keychain.")
    return r.stdout.strip()

def main():
    args = sys.argv[1:]
    force = "--force" in args
    names = [a for a in args if not a.startswith("--")] or list(SOUNDS)
    OUT.mkdir(parents=True, exist_ok=True)
    k = None
    for n in names:
        dest = OUT / f"{n}.mp3"
        if dest.exists() and not force:
            print(f"skip {n} (exists)")
            continue
        k = k or key()
        prompt, dur = SOUNDS[n]
        req = urllib.request.Request(
            "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_64",
            data=json.dumps({"text": prompt, "duration_seconds": dur, "prompt_influence": 0.5}).encode(),
            headers={"xi-api-key": k, "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                dest.write_bytes(resp.read())
        except urllib.error.HTTPError as e:
            sys.exit(f"{n}: HTTP {e.code}")
        print(f"wrote {n} ({dest.stat().st_size // 1024} KB)")

main()
