# CALL BELL 2.0 — Hospitality Service Bell

> **Two devices, one quiet touch.**  
> A premium, dedicated counter call bell for tablets and smartphones. Designed for boutiques, specialty stores, hotel reception counters, tasting rooms, and customer service desks.

---

## ✦ Key Enhancements in Version 2.0

1. **Hospitality Design System**
   - Palette: Deep forest green (`#0a1b14` / `#102b20`), muted olive/sage, warm ivory (`#faf8f2`), and champagne gold accents (`#d4b579`).
   - Clean typographic pairing: *Playfair Display* editorial headlines with *Plus Jakarta Sans* for user controls and readability.
   - Zero aggressive flashing — gentle expanding breathing aura rings for high visual prominence.

2. **Customer Kiosk Rebuilt**
   - Immersive full-screen tablet kiosk with prominent layered calling button.
   - Replaced old walking animation with a ringing service bell and ambient sound ripples.
   - Independent close (X) button allowing immediate dismissal of the popup without interrupting the 30-second cooldown period.
   - Subtle device vibration and pleasant button interaction audio on tap.

3. **Receiver Handset Alignment & Menu Overhaul**
   - Perfectly centered and aligned 3-line hamburger menu button.
   - Compact active shop code card with integrated miniature QR code (~52px) for instant scanning.
   - Streamlined diagnostic controls for audio/haptic testing and ntfy remote push verification.

4. **Engineered Camera QR Scanner**
   - High-contrast reticle viewfinder with animated laser guide.
   - Real-time `jsQR` decoding with fallback manual entry and graceful camera permission error handling.

5. **Creator Attribution**
   - Prominently styled: **Made by [miidhuneey!!](https://www.instagram.com/miidhunee/)** across footers, kiosk, and support drawer.

---

## ✦ Pairing Your Devices

```
┌─────────────────────────┐          SSE / ntfy          ┌─────────────────────────┐
│     COUNTER TABLET      │  ─────────────────────────>  │     SHOPKEEPER PHONE    │
│  Full-screen kiosk bell │                              │  Chimes, buzzes & rings │
└─────────────────────────┘                              └─────────────────────────┘
```

1. **Station 1 (Counter Tablet)**:
   - Open Call Bell on the tablet placed on the service desk.
   - Tap **"Customer Counter Tablet"**.
   - Tap the top-right menu (☰) → **"Enter Fullscreen"** to lock into kiosk mode.

2. **Station 2 (Your Phone)**:
   - Open Call Bell on your phone.
   - Tap **"Shopkeeper Handset"**.
   - Tap **SCAN** to scan the QR code displayed on the tablet (or enter the shop code manually) and tap **Pair Handset**.

---

## ✦ Configuring ntfy for Background Notifications

To receive calls even when your phone's browser is closed:

1. Install **ntfy** from the [Google Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy) or [Apple App Store](https://apps.apple.com/app/ntfy/id1625396347).
2. Open ntfy, tap the **+** button, and subscribe to your shop's topic (displayed on the paired screen as `call-bell-cb-xxxx`).
3. Set notification priority to **Max / Urgent** and allow sound and vibration.
4. On Android: Exclude ntfy from battery optimization for instantaneous delivery.

---

## ✦ Deploying to GitHub Pages

1. Push this repository to your GitHub account (e.g. `your-username/counter-bell`).
2. Go to **Settings** → **Pages**.
3. Under **Branch**, select `main` (or `master`) and folder `/ (root)`, then click **Save**.
4. Your PWA will be live at `https://your-username.github.io/counter-bell/`.

---

## ✦ Project Structure

```
counter-bell/
├── index.html            # Complete semantic HTML5 structure & view routing
├── styles.css            # Graded hospitality CSS variables, kiosk & animations
├── app.js                # Core controller: SSE stream, audio engine, scanner, timer
├── manifest.webmanifest  # Progressive Web App manifest
├── sw.js                 # Service worker for offline shell caching
├── icon-192.png          # PWA icon (192x192)
├── icon-512.png          # PWA icon (512x512)
├── icon-1024.png         # High-resolution asset (1024x1024)
├── apple-touch-icon.png  # iOS Home Screen touch icon
└── Readme.md             # Documentation and deployment guide
```

---

*Handcrafted with precision for modern hospitality.*  
*Creator: [miidhuneey!!](https://www.instagram.com/miidhunee/)*
