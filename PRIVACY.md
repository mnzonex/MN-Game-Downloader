# MN Game Downloader — Analytics & Privacy

MN Game Downloader uses anonymous, usage-focused analytics to understand which parts of the desktop app are used and to improve app features, performance and reliability. Analytics runs automatically while the app is running. There is no analytics toggle or account sign-in.

## What is collected

The app sends a limited set of allow-listed product analytics events, such as:

- App launches and app version/platform information.
- Which in-app feature is opened or used.
- Selected public game-source identifiers (for example, FitGirl, EroLabs, GOG, Steam or Epic).
- Download lifecycle outcomes: started, scheduled, paused, resumed, retried, completed, cancelled or failed.
- Download type, transferred byte totals, durations and a broad failure category.

PostHog assigns an anonymous app identifier so events from the same installation can be grouped into usage trends. This is a pseudonymous analytics identifier, not a verified real-world identity. The app does not create a PostHog person profile.

## What is not collected

The app's analytics allow-list excludes magnet links, download URLs, search query text, local file paths, filenames, usernames, account credentials, personal contact details and raw exception/error messages. Exception autocapture, session replay, DOM autocapture, remote feature flags, remote configuration and GeoIP enrichment are disabled.

Game titles and public source IDs may be included in download usage events so the developer can understand which catalog items and sources are popular. Do not enter personal information as a game title.

## Offline storage and transmission

When the computer is offline, the Electron analytics SDK stores queued events locally in the app's user-data folder. The queue is capped at 5 MB and events expire after seven days. When a connection is available, queued analytics events are sent over HTTPS to the configured PostHog US project endpoint at `https://us.i.posthog.com`. PostHog may also process ordinary network connection metadata needed to deliver the request.

Analytics is separate from the download engine. A PostHog/network failure must not stop downloads or prevent the app from starting. The application does not require a user account or a cloud profile.

## Purpose

The analytics are used only to understand aggregate product usage and improve MN Game Downloader's features, compatibility, download reliability and performance. They are not used for advertising or to sell user data.