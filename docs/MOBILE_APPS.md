# Mobile apps (Android and iPhone)

There are two ways onto a phone.

1. **The installable web app (PWA). It works today with nothing to build.** Parents, staff and students open the school's address and choose **Install** (Android, Chrome, Edge) or **Share → Add to Home Screen** (iPhone and iPad). After that it opens like an app, with push notifications on Android, desktop and iPhone (iOS 16.4 or later, once opened from the home screen). The portal pages (`/student`, `/teacher`, `/parent`, a parent's private link) and the class register open without a connection and show the last copy saved on the device.
2. **Store apps (Google Play and the App Store).** These are built from this repository with [Capacitor](https://capacitorjs.com). The store app is a native shell that loads the school site, and it adds native push through Firebase. The app code is already in place:
   - `capacitor.config.json`
   - `native/www` (start-up and offline pages)
   - `src/components/NativeBridge.tsx`, which registers the phone for push and opens the right page when a notification is tapped
   - `src/lib/messaging/fcm.ts`, which sends the notifications

   What remains is creating the native projects, signing and store submission, which need Android Studio and a Mac with Xcode.

## Building the store apps

1. Install Capacitor in the repository (once):

   ```sh
   npm i -D @capacitor/cli
   npm i @capacitor/core @capacitor/android @capacitor/ios @capacitor/push-notifications
   ```

2. In `capacitor.config.json`, set:
   - `server.url` to the live address, e.g. `https://app.yourschool.com`
   - `appId` to your reverse-domain id, e.g. `com.yourcompany.educlass`
   - `appName`

3. Create the native projects: `npx cap add android` and (on a Mac) `npx cap add ios`. Then run `npx cap sync` after any change to the config.

4. **Firebase** (push for both platforms):
   1. Create a project at console.firebase.google.com.
   2. Add an Android app with the same `appId`. Put `google-services.json` in `android/app/`.
   3. Add an iOS app with the same bundle id. Put `GoogleService-Info.plist` in `ios/App/App/`.
   4. In Xcode, turn on the **Push Notifications** and **Background Modes → Remote notifications** capabilities.
   5. Create an APNs key at developer.apple.com and upload it under Firebase → Project settings → Cloud Messaging.
   6. Firebase → Project settings → Service accounts → **Generate new private key**. Set `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL` and `FCM_PRIVATE_KEY` on the server. Paste the key on one line with `\n` for line breaks.

5. Icons and splash screens: add a 1024×1024 PNG icon, then run `npx @capacitor/assets generate`.

6. Build and sign:
   - Android: Android Studio → Build → Generate Signed App Bundle, then upload the `.aab` to Google Play Console.
   - iPhone: Xcode → Product → Archive, then upload to App Store Connect.

## How notifications reach the apps

- When someone signs in inside the store app, the phone asks for notification permission. Its Firebase token is then sent to `/api/push` (`subscribe_native`). Parents who use their private link are registered with that link.
- Every message that already went to web push also goes to these phones: results, sign-in alerts, fees, bus, wallet, messages, cover duties and approvals. The outbox sends `push` messages to web devices through VAPID and to app devices through Firebase.
- Signing out removes the device, so a shared phone stops getting the previous person's notifications.
- Each person chooses which groups of messages they get, and can set quiet hours:
  - staff and students under **Account security**
  - parents under **Notifications and language** in their portal

  During quiet hours, app, WhatsApp and SMS messages wait until the quiet period ends; email still arrives. Safety alerts are never held and cannot be turned off: emergencies, safeguarding, pickup codes, sick bay and trips.

## Store review notes

- Apple may turn down apps that only wrap a website (App Store guideline 4.2, minimum functionality). Native push, offline pages and the camera-based scanning (library, gate) help. Describe these in the review notes, and give the reviewer a demo parent login and a demo staff login.
- Both stores ask for a privacy policy URL and a data-safety form. The app collects contact details, children's school records and device tokens for notifications. It shows no adverts and does no tracking.
