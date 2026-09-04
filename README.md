# <img src="src/renderer/assets/lair-scout-mark.png" width="48" height="48" alt=""> Lair Scout

Lair Scout is a Windows desktop app for running and monitoring isolated Chromium sessions during [Secret Lair](https://secretlair.wizards.com) drops.

Each session is a separate browser profile. The dashboard shows live previews, queue status, and wait times so you can watch several places in line at once.

## Requirements

- Windows 10 or later (x64)
- For development from source: [Node.js](https://nodejs.org/) 20+

Installed copies from the Windows setup do not need Node.js. Chromium is bundled.

## Install

### Windows installer

From a source checkout with Node installed:

```bash
npm install
npm run dist
```

That writes `release/LairScout-<version>-setup.exe`. Run the setup to add Start Menu and Desktop shortcuts. Settings, the card vault, scout profiles, and debug dumps live under `%APPDATA%\lair-scout`.

Windows SmartScreen may warn on an unsigned build; choose **More info** → **Run anyway** if you built it yourself.

Unpacked output for local checks: `npm run dist:dir`.

### From source

```bash
npm install
```

This installs dependencies and Playwright’s Chromium build.

Start the app with `Start.cmd`, or:

```bash
npm run dev
```

To add Start Menu and Desktop shortcuts when running from source:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-start-menu.ps1
```

Quit from the app’s quit control, or close the terminal that launched it.

## Usage

1. Set the fleet size in the top bar. Two sessions start by default.
2. Point every scout at the drop with **Send all** (defaults to `https://secretlair.wizards.com/us`). Only `http` and `https` URLs are allowed.
3. Use **Cart & queue** when the product page is up. That adds to cart, continues as guest, and enters the Queue-it waiting room.
4. Watch status chips for lounge / in-queue / admitted. Alerts fire when a queue starts, a session is admitted, or a lounge message (including sold out) appears.

**Drive all** sends clicks, scroll, and keys to every scout. Open a scout to interact with that window only.

### Settings and payment

Checkout name, address, and card number/expiry are saved under **Settings**. They stay on this machine (`data/settings.json` and encrypted `data/card.vault.json` when running from source, or Electron user data when packaged). CVV is never written to disk — enter it only when you Arm Full Auto.

**Use test card** fills empty shipping fields and stores Stripe’s `4242` test PAN. If a real card is already saved, you must confirm before it is replaced. **Clear saved card** wipes the vaulted PAN and expiry.

### Full Auto

Switch to Full Auto, enter the product name, go-live time, fleet size, max orders, and CVV, then **Arm**. Scouts warm up before go-live, hunt the store for a matching listing, rush cart/queue, and complete guest checkout up to max orders. Remaining scouts abort after that. **Disarm** stops the run and clears payment secrets from the workers.

Checkout fill/place is retried a few times per scout, then that scout gives up so the rest of the fleet can still claim slots.

Optional **Save page HTML** writes cart/shipping dumps under `data/click-dumps/` for debugging. Payment pages and iframes are not dumped.

An optional OpenAI key in Settings is used only when two product listings look too similar to pick locally.

While Full Auto is armed, Windows sleep is blocked, fleet size/kill is locked, and a lounge sold-out message aborts idle scouts (in-flight checkouts keep going). An order confirmation plays an alert.

## Notes

Lair Scout is Windows-only. Window embedding and resource meters depend on Win32.

Each Chromium instance uses a lot of memory. The top bar shows CPU, GPU, and RAM; scale the fleet down if the machine starts swapping.
