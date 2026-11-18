# Call Bell v5

## Pair your devices
1. On the customer tablet, choose **This is the customer tablet**.
2. Tap the three-line menu in the kiosk and show the small QR code in Settings.
3. On your phone, choose **This is my phone**, tap **Scan**, allow camera access, and point at the tablet QR. The shop code is filled and copied automatically.
4. Tap **Connect & open ntfy app**. Subscribe to the displayed `call-bell-...` topic in ntfy if it has not already been subscribed.
5. Allow ntfy notifications. In Android Settings → Apps → ntfy → Notifications, turn on sound and vibration and choose a high-importance notification channel.
6. Open the receiver dashboard and use **TEST** for in-page sound/vibration and **PING** for ntfy delivery.

## Features
- Customer kiosk with animated call button, walking-person confirmation and 30-second cooldown.
- Working three-line kiosk settings menu, QR pairing, install instructions, fullscreen toggle and reset.
- Camera QR scanner using jsQR (rear camera) rather than relying only on BarcodeDetector.
- Creator credit **Mithuney!!** links to the Instagram profile without displaying the URL.
- ntfy SSE live listener and urgent ntfy HTTP notification.

## Important device limitations
- Camera scanning requires HTTPS, browser camera permission, and the jsQR library CDN to load. If scanning is unavailable, enter the shop code manually.
- Vibration has no browser permission prompt on Android. `navigator.vibrate()` is supported only by some browsers/devices, usually Android Chrome; iOS Safari does not support web vibration.
- The browser can vibrate only while its page is active. When the phone page is closed/backgrounded, ntfy's native app notification channel controls sound and vibration.
- The in-page chime needs a user gesture to unlock mobile audio; tap TEST once on the receiver dashboard.
- Opening `ntfy://` depends on the ntfy app registering that URI scheme. If Android does not open it, open ntfy manually and subscribe to the topic shown.
- A topic name is a shared secret URL, not authenticated access control. For higher security, use an authenticated/private ntfy server.

## Deploy
Upload all files in this folder to the same HTTPS static host. After deploying, refresh both devices and if an old version persists, clear the site's cached data or unregister its old service worker.
