# Lair Scout

Windows dashboard for a pile of isolated Chromium sessions. I use it on Secret Lair drops: park a few windows in the queue, drive them together, and get a ping when one gets through.

## Run

Needs Node. First time:

```
npm install
```

That also downloads Chromium via Playwright. After that, `start-lair-scout.cmd` or `npm run dev`. Close the terminal to quit.

`install-start-menu.ps1` puts a shortcut on the Desktop and in the Start menu.

## Heads-up

This is a Windows project. Each scout is its own browser profile, so RAM climbs fast if you scale up. Name/address autofill and the theme are saved in `settings.json` next to the repo when you run from source.
