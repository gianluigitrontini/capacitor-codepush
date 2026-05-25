# CodePush Invalid Deployment Fallback Fix

## Problem

On Android, app data can contain stale or broken CodePush metadata at `files/codepush/currentPackage.json`.
When `localPath` points to a deleted or incomplete deployment directory, Capacitor switches the WebView base path to that missing folder.
The app then opens `https://localhost/` but WebView cannot find `public/index.html`, so users see a "web page unavailable" error.

Clearing app storage fixes the issue because it deletes the stale CodePush metadata and deployment cache.

## Root Cause

`navigateToLocalDeploymentIfExists()` only checked whether `currentPackage.json.localPath` was non-null.
It did not verify that the referenced deployment still contained `public/index.html` before calling `bridge.setServerBasePath(...)`.

## Fix

Before switching to a CodePush deployment, Android now validates the deployment start page:

- Check `<filesDir>/<localPath>/public/index.html` with `getStartPageForPackage(...)`.
- If the start page is missing, log `CodePush deployment is invalid, falling back to bundled assets: ...`.
- Clear broken CodePush deployment files and install state.
- Return without changing Capacitor's server base path, so the app loads bundled APK assets normally.

This preserves normal hot update behavior: valid CodePush deployments still call `bridge.setServerBasePath(...)`.

## Files Changed

- `android/src/main/java/com/microsoft/capacitor/CodePush.java`

## Verification

Verified from `F:\net\UtApp`:

- Delete `node_modules/cap-codepush`.
- Reinstall `github:UTSOURCE/capacitor-codepush`.
- Confirm `package-lock.json` resolves to the fixed GitHub commit.
- Confirm installed plugin source contains the Android fallback guard.
- Run `npx ng build`.
- Run `npx cap sync android`.
- Run Android `assembleRelease`.
- Install the release APK on a connected Android device and verify startup logs do not show `localhost` / `ERR_` / `net::` load failure.
