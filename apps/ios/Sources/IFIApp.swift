import SwiftUI

/// Main app entry point
@main
struct IFIApp: App {
    /// App environment for dependency injection
    @StateObject private var environment = AppEnvironment()
    
    var body: some Scene {
        WindowGroup {
            AppTabView()
                .environmentObject(environment)
                .onAppear {
                    // Initialize app on first launch
                    if environment.appStore.threads.isEmpty {
                        environment.appStore.createThread(title: "Welcome")
                    }
                }
                .preferredColorScheme(.light)
        }
    }
}
