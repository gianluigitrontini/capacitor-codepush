import Foundation
import ZIPFoundation

@objc public class ZipHelper: NSObject {
    @objc(unzipAt:to:overwrite:error:)
    public static func unzip(
        at sourcePath: String,
        to destinationPath: String,
        overwrite: Bool,
        error errorPointer: NSErrorPointer
    ) -> Bool {
        let fileManager = FileManager.default
        let sourceURL = URL(fileURLWithPath: sourcePath)
        let destinationURL = URL(fileURLWithPath: destinationPath, isDirectory: true)

        do {
            if overwrite && fileManager.fileExists(atPath: destinationPath) {
                try fileManager.removeItem(at: destinationURL)
            }

            if !fileManager.fileExists(atPath: destinationPath) {
                try fileManager.createDirectory(
                    at: destinationURL,
                    withIntermediateDirectories: true,
                    attributes: nil
                )
            }

            try fileManager.unzipItem(at: sourceURL, to: destinationURL)
            return true
        } catch let unzipError as NSError {
            errorPointer?.pointee = unzipError
            NSLog("[ZipHelper] Unzip failed: %@", unzipError.localizedDescription)
            return false
        }
    }
}
