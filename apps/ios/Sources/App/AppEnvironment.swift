import SwiftUI
import Combine

/// Environment for app-wide dependencies and settings
class AppEnvironment: ObservableObject {
    /// API base URL
    @Published var apiBaseURL: URL = URL(string: "http://localhost:3000")!
    
    /// Auto-continue setting
    @Published var autoContinue: Bool = false
    
    /// Show reasoning setting
    @Published var showReasoning: Bool = false
    
    /// App data store
    let appStore: AppStore
    
    /// Initialize with default settings
    init() {
        self.appStore = AppStore()
        
        // Load settings from UserDefaults if available
        if let urlString = UserDefaults.standard.string(forKey: "apiBaseURL"),
           let url = URL(string: urlString) {
            self.apiBaseURL = url
        }
        
        self.autoContinue = UserDefaults.standard.bool(forKey: "autoContinue")
        self.showReasoning = UserDefaults.standard.bool(forKey: "showReasoning")
        
        // Save settings when they change
        setupSettingsObservers()
    }
    
    /// Reset all settings to defaults
    func resetToDefaults() {
        apiBaseURL = URL(string: "http://localhost:3000")!
        autoContinue = false
        showReasoning = false
        
        // Clear saved settings
        UserDefaults.standard.removeObject(forKey: "apiBaseURL")
        UserDefaults.standard.removeObject(forKey: "autoContinue")
        UserDefaults.standard.removeObject(forKey: "showReasoning")
    }
    
    /// Set up observers to save settings when they change
    private func setupSettingsObservers() {
        // Use Combine to observe changes to settings
        let cancellable = Publishers.CombineLatest3(
            $apiBaseURL,
            $autoContinue,
            $showReasoning
        )
        .sink { [weak self] url, autoContinue, showReasoning in
            guard let self = self else { return }
            
            // Save settings to UserDefaults
            UserDefaults.standard.set(url.absoluteString, forKey: "apiBaseURL")
            UserDefaults.standard.set(autoContinue, forKey: "autoContinue")
            UserDefaults.standard.set(showReasoning, forKey: "showReasoning")
        }
        
        // Store cancellable to prevent it from being deallocated
        _ = cancellable
    }
}
