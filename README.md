# Station Launcher

A tiny web app for Citi Bike / Bike Angels riders: type a few letters of a station name you saw in the official Citi Bike app, tap it, and your maps app opens with cycling directions to that exact station.

Built to be used **alongside** the official app — check point values there, navigate from here.

## Features

- Fuzzy station search tuned to Citi Bike names (`w52` → "W 52 St & 6 Ave", `1av` → "1 Ave & …")
- Live availability on every result: 🚲 classic bikes · ⚡ e-bikes · 🅿 open docks (from the public GBFS feed, refreshed every minute)
- Nearest stations listed when the search box is empty (uses your location, never leaves your phone)
- Recents row for one-tap repeat trips
- First-run picker for Google Maps or Apple Maps; change anytime via the ⚙︎ gear
- No backend, no accounts, no tracking — a single static page

## Use it on your phone

1. Open the site in Safari
2. Tap **Share → Add to Home Screen**
3. It launches full-screen like a regular app

## Data

Station list and live availability come from Citi Bike's public [GBFS feed](https://gbfs.citibikenyc.com/gbfs/gbfs.json). Bike Angels point values are not public, so this app doesn't show them — that's what the official app is for.

## Development

No build step. Serve the folder with any static server:

```
python -m http.server 8000
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
