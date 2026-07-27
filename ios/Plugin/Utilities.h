#import <Foundation/Foundation.h>

@interface Utilities : NSObject

+ (NSString *)getApplicationVersion;
+ (NSString *)getApplicationTimestamp;
+ (NSDate *)getApplicationBuildTime;
+ (BOOL)CDVWebViewEngineAvailable;

@end