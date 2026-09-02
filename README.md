# <img src="src/renderer/src/assets/lair-scout-mark.png" width="48" height="48" alt=""> Lair Scout

Lair Scout is a Windows desktop app for running and monitoring isolated Chromium sessions during [Secret Lair](https://secretlair.wizards.com) drops.

Each session is a separate browser profile. The dashboard shows live previews, queue status, and wait times so you can watch several places in line at once.

## Requirements

- Windows 10 or later
- [Node.js](https://nodejs.org/) 20+

## Install

```bash
npm install
```

This installs dependencies and Playwright’s Chromium build.

Start the app with `start-lair-scout.cmd` or:

```bash
npm run dev
```

To add Start Menu and Desktop shortcuts:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-start-menu.ps1
```

Close the terminal that launched the app to shut it down.

## Usage

1. Set the fleet size in the top bar. Two sessions start by default.
2. Point every scout at the drop with **Send all** (defaults to `https://secretlair.wizards.com/us`).
3. Use **Cart & queue** when the product page is up. That adds to cart, continues as guest, and enters the Queue-it waiting room.
4. Watch status chips for lounge / in-queue / admitted. Alerts fire when a queue starts, a session is admitted, or a lounge message (including sold out) appears.

**Drive all** sends clicks, scroll, and keys to every scout. Open a scout to interact with that window only. Checkout name and address can be saved under Settings; they are stored on this machine and filled into guest checkout forms.

## Notes

Lair Scout is Windows-only. Window embedding and resource meters depend on Win32.

Each Chromium instance uses a lot of memory. The top bar shows CPU, GPU, and RAM; scale the fleet down if the machine starts swapping.

Settings (theme, shipping autofill) are written to `settings.json` in the project directory when running from source.
