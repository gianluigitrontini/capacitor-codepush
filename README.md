# Capacitor Plugin for CodePush

This version is a fork of Mapiacompany's Capacitor Codepush, updated to work with the latest Capacitor. I use this daily in my company.

## References

#### Setup a Codepush Server
- [https://github.com/lisong/code-push-server](https://github.com/lisong/code-push-server)

#### Setup Codepush CLI
- [https://github.com/shm-open/code-push-cli](https://github.com/shm-open/code-push-cli)

#### Take a look at the original README for this project
I simplified this documentation to provide a quick Getting Started. For any doubt or extended functionality, consult the original README:
- [ORIGINAL_README.md](/ORIGINAL_README.md)


## Install the plugin to your Capacitor project

#### Capacitor 7
```
npm i cap-codepush@7
```

### Previous versions
Old naming convention

#### Capacitor 6
```
npm i cap-codepush@3
```
#### Capacitor 5
```
npm i cap-codepush@2
```
#### Capacitor 4
```
npm i cap-codepush@1
```

## Add App to the CodePush Server via CLI

### Install the CLI
- [https://github.com/shm-open/code-push-cli](https://github.com/shm-open/code-push-cli)

### Authentication

#### Authenticate the CLI to your server
Don't have a Codepush Server?
- [https://github.com/lisong/code-push-server](https://github.com/lisong/code-push-server)

```bash
code-push register https://your-codepush-server-ip:10443
```

Use your own credentials provided by the server admin.

#### Register a New App

Each app must have two versions:

- One for Android (suffix `-android`)
    
- One for iOS (suffix `-ios`)
    

The **platform** can be `ios` or `android`.

The **technology** to select is `cordova`, even if you are using Capacitor.

```bash
code-push app add <app-name-with-suffix> <platform> <technology>

# Example (execute both for each app):
code-push app add myapp-ios ios cordova
code-push app add myapp-android android cordova
```

### Project Integration

Add the following snippet in `app.component.ts`:

Example with Ionic+Angular
```ts
import { CodePush, InstallMode } from 'cap-codepush';

async ngOnInit() {
    await this.initializeCodepush();
}

private async initializeCodepush() {
  CodePush.sync({
    onSyncStatusChanged: (syncStatus) => { 
      console.log('Sync status changed: ', syncStatus);
    },
    installMode: InstallMode.IMMEDIATE,
  }).then(
    (status) => {
      if (status) {
        console.log(status);
      }
    },
    (error) => {
      if (error) {
        console.log(error);
      }
    }
  );
}
```

Update `capacitor.config.ts` with:

```js
plugins: {
  CodePush: {
    SERVER_URL: "https://your-codepush-server.com:10443/",
    IOS_DEPLOY_KEY: IS_DEV ? "[your development key]" : "[your production key]",
    ANDROID_DEPLOY_KEY: IS_DEV ? "[your development key]" : "[your production key]",
  }
}
```

## Releasing a New Version of Your App

The **path to the `public` folder** is always:

- Android: `android/app/src/main/assets/public/`
    
- iOS: `ios/App/App/public/`

#### Manual Release

```bash
ionic cap sync # synchronize Ionic with native project
code-push release <app-name> <public-folder-path> <target-version> -d <deployment>

# Example:
ionic cap sync

code-push release myapp-android android/app/src/main/assets/public/ 1.0.0 -d "Production"

code-push release myapp-ios ios/App/App/public/ 1.0.0 -d "Production"
```

## Useful Commands

**List all apps available on the CodePush server**

```bash
code-push app ls
```

**List all deployments for a given app**

```bash
code-push deployment ls <app-name>

# To show deployment tokens as well:
code-push deployment ls <app-name> -k

# Example:
code-push deployment ls myapp-ios
```

### Delete All Deployments for an App

⚠️ This command will **not** rollback updates already installed by users.

```bash
code-push deployment clear <app-name> <deployment-name>

# Example:
code-push deployment clear myapp-android Production
code-push deployment clear myapp-android Staging
```
