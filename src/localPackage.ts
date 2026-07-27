import { Directory, Filesystem, GetUriOptions } from "@capacitor/filesystem";
import { AcquisitionStatus } from "code-push/script/acquisition-sdk";
import { Callback, ErrorCallback, SuccessCallback } from "./callbackUtil";
import { CodePushUtil } from "./codePushUtil";
import { FileUtil } from "./fileUtil";
import { InstallMode } from "./installMode";
import { InstallOptions } from "./installOptions";
import { NativeAppInfo } from "./nativeAppInfo";
import { CodePush as NativeCodePush } from "./nativeCodePushPlugin";
import { ILocalPackage, IPackageInfoMetadata, Package } from "./package";
import { Sdk } from "./sdk";


/**
 * Defines the JSON format of the package diff manifest file.
 */
interface IDiffManifest {
    deletedFiles: string[];
}

/**
 * Defines the result of LocalPackage.handleDeployment execution.
 */
interface DeploymentResult {
    deployDir: string;
    isDiffUpdate: boolean;
}

/**
 * Defines a local package.
 *
 * !! THIS TYPE IS READ FROM NATIVE CODE AS WELL. ANY CHANGES TO THIS INTERFACE NEEDS TO BE UPDATED IN NATIVE CODE !!
 */
export class LocalPackage extends Package implements ILocalPackage {
    public static RootDir: string = "codepush";

    public static DownloadDir: string = LocalPackage.RootDir + "/download";
    private static DownloadUnzipDir: string = LocalPackage.DownloadDir + "/unzipped";
    private static DeployDir: string = LocalPackage.RootDir + "/deploy";
    private static VersionsDir: string = LocalPackage.DeployDir + "/versions";

    public static PackageUpdateFileName: string = "update.zip";
    public static PackageInfoFile: string = "currentPackage.json";
    public static OldPackageInfoFile: string = "oldPackage.json";
    private static DiffManifestFile: string = "hotcodepush.json";

    private static DefaultInstallOptions: InstallOptions;

    /**
     * The local storage path where this package is located.
     */
    localPath: string;

    /**
     * Indicates if the current application run is the first one after the package was applied.
     */
    isFirstRun: boolean;

    /**
     * Applies this package to the application. The application will be reloaded with this package and on every application launch this package will be loaded.
     * On the first run after the update, the application will wait for a codePush.notifyApplicationReady() call. Once this call is made, the install operation is considered a success.
     * Otherwise, the install operation will be marked as failed, and the application is reverted to its previous version on the next run.
     *
     * @param installOptions Optional parameter used for customizing the installation behavior.
     */
    public async install(installOptions?: InstallOptions): Promise<InstallMode> {
        return new Promise<InstallMode>(async (resolve, reject) => {
            try {
                CodePushUtil.logMessage("Installing update");

                if (!installOptions) {
                    installOptions = LocalPackage.getDefaultInstallOptions();
                } else {
                    CodePushUtil.copyUnassignedMembers(LocalPackage.getDefaultInstallOptions(), installOptions);
                }

                var installError: ErrorCallback = (error: Error): void => {
                    CodePushUtil.invokeErrorCallback(error, reject);
                    Sdk.reportStatusDeploy(this, AcquisitionStatus.DeploymentFailed, this.deploymentKey);
                };

                let unzipDir;
                try {
                    unzipDir = await FileUtil.cleanDataDirectory(LocalPackage.DownloadUnzipDir);
                } catch (error) {
                    installError(error);
                    return;
                }

                try {
                    await NativeCodePush.unzip({zipFile: this.localPath, targetDirectory: unzipDir});
                } catch (unzipError) {
                    installError(new Error("Could not unzip package" + CodePushUtil.getErrorMessage(unzipError)));
                    return;
                }

                try {
                    const newPackageLocation = LocalPackage.VersionsDir + "/" + this.packageHash;
                    const deploymentResult = await LocalPackage.handleDeployment(newPackageLocation);
                    await this.verifyPackage(deploymentResult);
                    this.localPath = deploymentResult.deployDir;
                    this.finishInstall(deploymentResult.deployDir, installOptions, resolve, installError);
                } catch (error) {
                    installError(error);
                }
            } catch (e) {
                installError && installError(new Error("An error occured while installing the package. " + CodePushUtil.getErrorMessage(e)));
            }
        });
    }

    private verifyPackage(deploymentResult: DeploymentResult): Promise<void> {
        return new Promise((resolve, reject) => {
            var deployDir = deploymentResult.deployDir;

            var verificationFail: ErrorCallback = (error: Error) => {
                reject(error);
            };

            var verify = (isSignatureVerificationEnabled: boolean, isSignatureAppearedInBundle: boolean, publicKey: string, signature: string) => {
                if (isSignatureVerificationEnabled) {
                    if (isSignatureAppearedInBundle) {
                        this.verifyHash(deployDir, this.packageHash, verificationFail, () => {
                            this.verifySignature(deployDir, this.packageHash, publicKey, signature, verificationFail, resolve);
                        });
                    } else {
                        var errorMessage =
                        "Error! Public key was provided but there is no JWT signature within app bundle to verify. " +
                        "Possible reasons, why that might happen: \n" +
                        "1. You've been released CodePush bundle update using version of CodePush CLI that is not support code signing.\n" +
                        "2. You've been released CodePush bundle update without providing --privateKeyPath option.";
                        reject(new Error(errorMessage));
                    }
                } else {
                    if (isSignatureAppearedInBundle) {
                        CodePushUtil.logMessage(
                            "Warning! JWT signature exists in codepush update but code integrity check couldn't be performed because there is no public key configured. " +
                            "Please ensure that public key is properly configured within your application."
                        );

                        // verifyHash
                        this.verifyHash(deployDir, this.packageHash, verificationFail, resolve);
                    } else {
                        if (deploymentResult.isDiffUpdate){
                            // verifyHash
                            this.verifyHash(deployDir, this.packageHash, verificationFail, resolve);
                        } else {
                            resolve();
                        }
                    }
                }
            };

            if (deploymentResult.isDiffUpdate){
                CodePushUtil.logMessage("Applying diff update");
            } else {
                CodePushUtil.logMessage("Applying full update");
            }

            var isSignatureVerificationEnabled: boolean, isSignatureAppearedInBundle: boolean;
            var publicKey: string;

            this.getPublicKey((error, publicKeyResult) => {
                if (error) {
                    reject(new Error("Error reading public key. " + error));
                    return;
                }

                publicKey = publicKeyResult;
                isSignatureVerificationEnabled = !!publicKey;

                this.getSignatureFromUpdate(deploymentResult.deployDir, (error, signature) => {
                    if (error) {
                        reject(new Error("Error reading signature from update. " + error));
                        return;
                    }

                    isSignatureAppearedInBundle = !!signature;

                    verify(isSignatureVerificationEnabled, isSignatureAppearedInBundle, publicKey, signature);
                });
            });
        });
    }

    private getPublicKey(callback: Callback<string>) {

        var success = (publicKey: string) => {
            callback(null, publicKey);
        };

        var fail = (error: Error) => {
            callback(error, null);
        };

        NativeCodePush.getPublicKey().then(result => success(result.value || null), fail);
    }

    private async getSignatureFromUpdate(deployDir: string, callback: Callback<string>){

        const filePath = deployDir + "/public/.codepushrelease";

        if (!await FileUtil.fileExists(Directory.Data, filePath)) {
            // signature absents in the bundle
            callback(null, null);
            return;
        }

        try {
            const signature = await FileUtil.readFile(Directory.Data, filePath);
            callback(null, signature);
        } catch (error) {
            // error reading signature file from bundle
            callback(error, null);
        }
    }

    private verifyHash(deployDir: string, newUpdateHash: string, errorCallback: ErrorCallback, successCallback: SuccessCallback<void>){
        var packageHashSuccess = (computedHash: string) => {
            if (computedHash !== newUpdateHash) {
                errorCallback(new Error("The update contents failed the data integrity check."));
                return;
            }

            CodePushUtil.logMessage("The update contents succeeded the data integrity check.");
            successCallback();
        };
        var packageHashFail = (error: Error) => {
            errorCallback(new Error("Unable to compute hash for package: " + error));
        };
        CodePushUtil.logMessage("Verifying hash for folder path: " + deployDir);
        NativeCodePush.getPackageHash({path: deployDir}).then(result => packageHashSuccess(result.value), packageHashFail);
    }

    private verifySignature(deployDir: string, newUpdateHash: string, publicKey: string, signature: string, errorCallback: ErrorCallback, successCallback: SuccessCallback<void>){
        var decodeSignatureSuccess = (contentHash: string) => {
            if (contentHash !== newUpdateHash) {
                errorCallback(new Error("The update contents failed the code signing check."));
                return;
            }

            CodePushUtil.logMessage("The update contents succeeded the code signing check.");
            successCallback();
        };
        var decodeSignatureFail = (error: Error) => {
            errorCallback(new Error("Unable to verify signature for package: " + error));
        };
        CodePushUtil.logMessage("Verifying signature for folder path: " + deployDir);
        NativeCodePush.decodeSignature({publicKey, signature}).then(result => decodeSignatureSuccess(result.value), decodeSignatureFail);
    }

    private finishInstall(deployDir: string, installOptions: InstallOptions, installSuccess: SuccessCallback<InstallMode>, installError: ErrorCallback): void {
        async function backupPackageInformationFileIfNeeded(backupIfNeededDone: Callback<void>) {
            const pendingUpdate = await NativeAppInfo.isPendingUpdate();
            if (pendingUpdate) {
                // Don't back up the  currently installed update since it hasn't been "confirmed"
                backupIfNeededDone(null, null);
            } else {
                try {
                    await LocalPackage.backupPackageInformationFile();
                    backupIfNeededDone(null, null);
                } catch (err) {
                    backupIfNeededDone(err, null);
                }
            }
        }

        LocalPackage.getCurrentOrDefaultPackage().then((oldPackage: LocalPackage) => {
            backupPackageInformationFileIfNeeded((backupError: Error) => {
                /* continue on error, current package information is missing if this is the first update */
                this.writeNewPackageMetadata().then(() => {
                    var invokeSuccessAndInstall = () => {
                        CodePushUtil.logMessage("Install succeeded.");
                        var installModeToUse: InstallMode = this.isMandatory ? installOptions.mandatoryInstallMode : installOptions.installMode;
                        if (installModeToUse === InstallMode.IMMEDIATE) {
                            /* invoke success before navigating */
                            installSuccess && installSuccess(installModeToUse);
                            /* no need for callbacks, the javascript context will reload */
                            NativeCodePush.install({
                                startLocation: deployDir,
                                installMode: installModeToUse,
                                minimumBackgroundDuration: installOptions.minimumBackgroundDuration
                            });
                        } else {
                            NativeCodePush.install({
                                startLocation: deployDir,
                                installMode: installModeToUse,
                                minimumBackgroundDuration: installOptions.minimumBackgroundDuration
                            }).then(() => { installSuccess && installSuccess(installModeToUse); }, () => { installError && installError(); });
                        }
                    };

                    var preInstallSuccess = () => {
                        /* package will be cleaned up after success, on the native side */
                        invokeSuccessAndInstall();
                    };

                    var preInstallFailure = (preInstallError?: any) => {
                        CodePushUtil.logError("Preinstall failure.", preInstallError);
                        var error = new Error("An error has occured while installing the package. " + CodePushUtil.getErrorMessage(preInstallError));
                        installError && installError(error);
                    };

                    NativeCodePush.preInstall({startLocation: deployDir}).then(preInstallSuccess, preInstallFailure);
                }, (writeMetadataError: Error) => {
                    installError && installError(writeMetadataError);
                });
            });
        }, installError);
    }

    private static async handleDeployment(newPackageLocation: string): Promise<DeploymentResult> {
        const manifestFile: GetUriOptions = {
            directory: Directory.Data,
            path: LocalPackage.DownloadUnzipDir + "/" + LocalPackage.DiffManifestFile
        };
        const isDiffUpdate = await FileUtil.fileExists(manifestFile.directory, manifestFile.path);

        if (!(await FileUtil.directoryExists(Directory.Data, LocalPackage.VersionsDir))) {
            // If directory not exists, create recursive folder
            await Filesystem.mkdir({
                path: LocalPackage.VersionsDir,
                directory: Directory.Data,
                recursive: true
            });
        }

        if (isDiffUpdate) {
            await LocalPackage.handleDiffDeployment(newPackageLocation, manifestFile);
        } else {
            await LocalPackage.handleCleanDeployment(newPackageLocation);
        }

        return {deployDir: newPackageLocation, isDiffUpdate};
    }

    private async writeNewPackageMetadata(): Promise<void> {
        const timestamp = await NativeAppInfo.getApplicationBuildTime().catch(buildTimeError => {
            CodePushUtil.logError("Could not get application build time. " + buildTimeError);
        });
        const appVersion = await NativeAppInfo.getApplicationVersion().catch(appVersionError => {
            CodePushUtil.logError("Could not get application version." + appVersionError);
        });

        const currentPackageMetadata: IPackageInfoMetadata = {
            nativeBuildTime: timestamp as string,
            localPath: this.localPath,
            appVersion: appVersion as string,
            deploymentKey: this.deploymentKey,
            description: this.description,
            isMandatory: this.isMandatory,
            packageSize: this.packageSize,
            label: this.label,
            packageHash: this.packageHash,
            isFirstRun: false,
            failedInstall: false,
            install: undefined
        };

        return new Promise<void>((resolve, reject) => {
            LocalPackage.writeCurrentPackageInformation(currentPackageMetadata, error => error ? reject(error) : resolve());
        });
    }

    private static async handleCleanDeployment(newPackageLocation: string): Promise<void> {
        // no diff manifest
        const source: GetUriOptions = {directory: Directory.Data, path: LocalPackage.DownloadUnzipDir};
        const target: GetUriOptions = {directory: Directory.Data, path: newPackageLocation};
        // TODO: create destination directory if it doesn't exist
        return FileUtil.copyDirectoryEntriesTo(source, target);
    }

    private static async copyCurrentPackage(newPackageLocation: string, ignoreList: string[]): Promise<void> {
        const currentPackagePath = await new Promise<string | void>(resolve => {
            LocalPackage.getPackage(LocalPackage.PackageInfoFile, (currentPackage: LocalPackage) => resolve(currentPackage.localPath), () => resolve());
        });

        newPackageLocation = currentPackagePath ? newPackageLocation : newPackageLocation + "/public";

        // https://github.com/ionic-team/capacitor/pull/2514 Directory.Application variable was removed. (TODO - for check)
        const source: GetUriOptions = currentPackagePath ? {directory: Directory.Data, path: currentPackagePath} : {directory: Directory.Data, path: "public"};
        const target: GetUriOptions = {directory: Directory.Data, path: newPackageLocation};

        return FileUtil.copyDirectoryEntriesTo(source, target, ignoreList);
    }

    private static async handleDiffDeployment(newPackageLocation: string, diffManifest: GetUriOptions): Promise<void> {
        let manifest: IDiffManifest;
        try {
            await LocalPackage.copyCurrentPackage(newPackageLocation, [".codepushrelease"]);
            await LocalPackage.handleCleanDeployment(newPackageLocation);

            /* delete files mentioned in the manifest */
            const content = await FileUtil.readFile(diffManifest.directory, diffManifest.path);
            manifest = JSON.parse(content);
            await FileUtil.deleteEntriesFromDataDirectory(newPackageLocation, manifest.deletedFiles);
        } catch (error) {
            throw new Error("Cannot perform diff-update.");
        }
    }

    /**
    * Writes the given local package information to the current package information file.
    * @param packageInfoMetadata The object to serialize.
    * @param callback In case of an error, this function will be called with the error as the fist parameter.
    */
    public static writeCurrentPackageInformation(packageInfoMetadata: IPackageInfoMetadata, callback: Callback<void>): void {
        var content = JSON.stringify(packageInfoMetadata);
        FileUtil.writeStringToDataFile(content, LocalPackage.RootDir + "/" + LocalPackage.PackageInfoFile, true, callback);
    }

    /**
     * Backs up the current package information to the old package information file.
     * This file is used for recovery in case of an update going wrong.
     * @param callback In case of an error, this function will be called with the error as the fist parameter.
     */
    public static async backupPackageInformationFile(): Promise<void> {
        const currentPackagePath =
            LocalPackage.RootDir + "/" + LocalPackage.PackageInfoFile;
        if (!(await FileUtil.fileExists(Directory.Data, currentPackagePath))) {
            return;
        }

        const source: GetUriOptions = {
            directory: Directory.Data,
            path: currentPackagePath
        };

        const destination: GetUriOptions = {
            directory: Directory.Data,
            path: LocalPackage.RootDir + "/" + LocalPackage.OldPackageInfoFile
        };

        return FileUtil.copy(source, destination);
    }

    /**
     * Get the previous package information.
     *
     * @param packageSuccess Callback invoked with the old package information.
     * @param packageError Optional callback invoked in case of an error.
     */
    public static getOldPackage(packageSuccess: SuccessCallback<LocalPackage>, packageError?: ErrorCallback): void {
        LocalPackage.getPackage(LocalPackage.OldPackageInfoFile, packageSuccess, packageError);
    }

    /**
     * Reads package information from a given file.
     *
     * @param packageFile The package file name.
     * @param packageSuccess Callback invoked with the package information.
     * @param packageError Optional callback invoked in case of an error.
     */
    public static async getPackage(packageFile: string, packageSuccess: SuccessCallback<LocalPackage>, packageError?: ErrorCallback): Promise<void> {
        var handleError = (e: Error) => {
            packageError && packageError(new Error("Cannot read package information. " + CodePushUtil.getErrorMessage(e)));
        };

        try {
            const packagePath = LocalPackage.RootDir + "/" + packageFile;
            if (!(await FileUtil.fileExists(Directory.Data, packagePath))) {
                packageError &&
                    packageError(new Error("Package information file does not exist."));
                return;
            }

            const content = await FileUtil.readDataFile(packagePath);
            const packageInfo: IPackageInfoMetadata = JSON.parse(content);
            LocalPackage.getLocalPackageFromMetadata(packageInfo).then(packageSuccess, packageError);
        } catch (e) {
            handleError(e);
        }
    }

    private static async getLocalPackageFromMetadata(metadata: IPackageInfoMetadata): Promise<LocalPackage> {
        if (!metadata) {
            throw new Error("Invalid package metadata.");
        }

        const installFailed = await NativeAppInfo.isFailedUpdate(metadata.packageHash);
        const isFirstRun = await NativeAppInfo.isFirstRun(metadata.packageHash);
        const localPackage = new LocalPackage();

        localPackage.appVersion = metadata.appVersion;
        localPackage.deploymentKey = metadata.deploymentKey;
        localPackage.description = metadata.description;
        localPackage.isMandatory = metadata.isMandatory;
        localPackage.failedInstall = installFailed;
        localPackage.isFirstRun = isFirstRun;
        localPackage.label = metadata.label;
        localPackage.localPath = metadata.localPath;
        localPackage.packageHash = metadata.packageHash;
        localPackage.packageSize = metadata.packageSize;
        return localPackage;
    }

    public static getCurrentOrDefaultPackage(): Promise<LocalPackage> {
        return LocalPackage.getPackageInfoOrDefault(LocalPackage.PackageInfoFile);
    }

    public static async getOldOrDefaultPackage(): Promise<LocalPackage> {
        return LocalPackage.getPackageInfoOrDefault(LocalPackage.OldPackageInfoFile);
    }

    public static async getPackageInfoOrDefault(packageFile: string): Promise<LocalPackage> {
        return new Promise<LocalPackage>((resolve, reject) => {
            const packageFailure = async () => {
                /**
                 * For the default package we need the app version,
                 * and ideally the hash of the binary contents.
                 */
                let appVersion;
                try {
                    appVersion = await NativeAppInfo.getApplicationVersion();
                } catch (appVersionError) {
                    CodePushUtil.logError("Could not get application version." + appVersionError);
                    reject(appVersionError);
                    return;
                }

                const defaultPackage: LocalPackage = new LocalPackage();
                defaultPackage.appVersion = appVersion;
                try {
                    defaultPackage.packageHash = await NativeAppInfo.getBinaryHash();
                } catch (binaryHashError) {
                    CodePushUtil.logError("Could not get binary hash." + binaryHashError);
                }

                resolve(defaultPackage);
            };

            LocalPackage.getPackage(packageFile, resolve as any, packageFailure);
        });
    }

    public static getPackageInfoOrNull(packageFile: string, packageSuccess: SuccessCallback<LocalPackage>, packageError?: ErrorCallback): void {
        LocalPackage.getPackage(packageFile, packageSuccess, packageSuccess.bind(null, null));
    }

    /**
     * Returns the default options for the CodePush install operation.
     * If the options are not defined yet, the static DefaultInstallOptions member will be instantiated.
     */
    private static getDefaultInstallOptions(): InstallOptions {
        if (!LocalPackage.DefaultInstallOptions) {
            LocalPackage.DefaultInstallOptions = {
                installMode: InstallMode.ON_NEXT_RESTART,
                minimumBackgroundDuration: 0,
                mandatoryInstallMode: InstallMode.IMMEDIATE
            };
        }

        return LocalPackage.DefaultInstallOptions;
    }
}
