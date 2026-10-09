# AdShield – ad blocker for your phone

Blocks ads, trackers, and malware sites in **every app and browser** on your
phone. No root, no account, no subscription, nothing leaves your phone.

---

## Quick setup (about 1 minute)

### Android

1. On your phone, open this link and download the app:
   **https://github.com/fvaldezbaez1-hash/Ahdaaa/releases/latest/download/AdShield.apk**
2. Tap the downloaded file → **Install**. (If asked, allow your browser to
   "install unknown apps".)
3. Open **AdShield** and tap the big button.
4. Tap **OK** on the "Connection request" popup.

Done. The button turns green and ads start getting blocked right away. The
full blocklists (about 300,000 ad and tracker domains) download by themselves
in the background and update every few days.

**Optional:** swipe down your quick settings, tap the ✏️ pencil, and drag the
**Ad blocker** tile in for one-tap on/off.

> **If ads still show:** open phone **Settings**, search **Private DNS**, and
> set it to **Off** or **Automatic**. A custom Private DNS goes around the
> blocker.

### iPhone / iPad

Apple doesn't allow installing apps from outside the App Store, so on iPhone
AdShield uses an encrypted ad-blocking DNS profile instead. It's just as quick:

1. In **Safari**, open
   **https://github.com/fvaldezbaez1-hash/Ahdaaa/releases/latest/download/AdShield-iPhone.mobileconfig**
   and tap **Allow**. (If nothing pops up, save it to Files and tap it there.)
2. Open **Settings** → **Profile Downloaded** → **Install**.
3. Go to **Settings → General → VPN & Device Management → DNS** and make sure
   **AdShield** is selected.

To remove it later: **Settings → General → VPN & Device Management** → AdShield → Remove.

### No-install option (any Android 9+)

Settings → search **Private DNS** → **Private DNS provider hostname** →
type `dns.adguard-dns.com` → Save. That's it. (Don't combine this with the
AdShield app — pick one. The app blocks more and you can customise it.)

---

## What it can and can't block

✅ Ads and trackers in apps, games, and browsers, pop-up ad networks,
malware and scam sites, analytics/telemetry.

❌ Ads served from the same server as the content itself — mainly **YouTube**
video ads and Instagram/Facebook sponsored posts. No DNS blocker (on any
phone) can remove those without breaking the app. For the browser, use
**Firefox for Android + the uBlock Origin add-on** alongside AdShield.

## How it works

AdShield creates a tiny local VPN that only captures DNS lookups (the "phone
book" requests apps make before loading anything). Lookups for known ad and
tracker domains are answered with "nowhere" (`0.0.0.0`) on the phone itself;
everything else is passed to a real DNS server. All your other traffic goes
straight to the internet as normal, so it uses almost no battery and doesn't
slow anything down. Nothing is logged or sent anywhere.

## Advanced settings (in the app)

Tap **Advanced settings** at the bottom of the main screen for:

- **Recent activity** — see what was blocked; tap any site to allow or block it.
- **Blocklists** — HaGeZi Multi PRO and StevenBlack are on by default. You can
  add AdGuard, OISD Big, AdAway, or HaGeZi Threat Intelligence.
- **DNS server** — Cloudflare (default), AdGuard DNS (double filtering), Quad9, Google.
- **Always allow / Always block** — your own rules. If an app or site breaks,
  find it in Recent activity and tap **Allow**.
- **Always-on VPN** — makes Android keep AdShield running permanently.

AdShield also turns itself back on after a reboot if it was on before.

## Building it yourself

Every push builds the APK on GitHub Actions (see the **Actions** tab, artifact
`AdShield-apk`). Pushes to the default branch also publish a release with the
download links above.

Locally: `./gradlew assembleRelease` (needs the Android SDK).

The APK is signed with a temporary key unless you add your own. To make future
versions install as updates over the old one, add these repository secrets:
`SIGNING_KEYSTORE_BASE64`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS`,
`SIGNING_KEY_PASSWORD`. Without them, if an update refuses to install, just
uninstall the old AdShield first.
