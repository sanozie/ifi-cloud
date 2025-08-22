import SwiftUI

/// Root settings view with all app settings
struct SettingsRootView: View {
    /// Environment for app-wide dependencies and settings
    @EnvironmentObject private var environment: AppEnvironment
    
    /// Text field for API URL
    @State private var apiURLText: String = ""
    
    /// Alert state
    @State private var showAlert = false
    @State private var alertTitle = ""
    @State private var alertMessage = ""
    
    var body: some View {
        List {
            // Connections Section
            Section(header: Text("Connections")) {
                NavigationLink(destination: Text("Connections View")) {
                    Label("GitHub", systemImage: "arrow.triangle.branch")
                }
                
                NavigationLink(destination: Text("Connections View")) {
                    Label("Notion", systemImage: "doc.text")
                }
            }
            
            // Preferences Section
            Section(header: Text("Preferences")) {
                // API Base URL
                VStack(alignment: .leading) {
                    Text("API Base URL")
                        .font(.headline)
                        .padding(.bottom, 4)
                    
                    TextField("https://api.example.com", text: $apiURLText)
                        .textFieldStyle(.roundedBorder)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .onSubmit {
                            updateAPIBaseURL()
                        }
                    
                    Button("Update") {
                        updateAPIBaseURL()
                    }
                    .buttonStyle(.bordered)
                    .padding(.top, 4)
                }
                .padding(.vertical, 4)
                
                // Auto-continue toggle
                Toggle(isOn: $environment.autoContinue) {
                    Label("Auto-continue", systemImage: "arrow.triangle.2.circlepath")
                }
                .toggleStyle(.switch)
                
                // Show reasoning toggle
                Toggle(isOn: $environment.showReasoning) {
                    Label("Show reasoning", systemImage: "brain")
                }
                .toggleStyle(.switch)
            }
            
            // Provider Models Section
            Section(header: Text("Provider Models")) {
                NavigationLink(destination: Text("Provider Settings View")) {
                    Label("AI Models", systemImage: "cpu")
                }
                
                NavigationLink(destination: Text("Speech Settings View")) {
                    Label("Speech Recognition", systemImage: "mic")
                }
            }
            
            // About Section
            Section(header: Text("About")) {
                NavigationLink(destination: Text("About View")) {
                    Label("About IFI", systemImage: "info.circle")
                }
                
                HStack {
                    Text("Version")
                    Spacer()
                    Text("1.0.0")
                        .foregroundStyle(.secondary)
                }
                
                Button(role: .destructive) {
                    resetSettings()
                } label: {
                    Label("Reset All Settings", systemImage: "arrow.counterclockwise")
                        .foregroundColor(.red)
                }
            }
        }
        .navigationTitle("Settings")
        .onAppear {
            apiURLText = environment.apiBaseURL.absoluteString
        }
        .alert(alertTitle, isPresented: $showAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(alertMessage)
        }
    }
    
    /// Update API base URL from text field
    private func updateAPIBaseURL() {
        guard !apiURLText.isEmpty else {
            showAlert(title: "Invalid URL", message: "URL cannot be empty")
            return
        }
        
        guard let url = URL(string: apiURLText) else {
            showAlert(title: "Invalid URL", message: "Please enter a valid URL")
            return
        }
        
        environment.apiBaseURL = url
        showAlert(title: "URL Updated", message: "API base URL has been updated")
    }
    
    /// Reset all settings to defaults
    private func resetSettings() {
        environment.resetToDefaults()
        apiURLText = environment.apiBaseURL.absoluteString
        showAlert(title: "Settings Reset", message: "All settings have been reset to defaults")
    }
    
    /// Show an alert with the given title and message
    private func showAlert(title: String, message: String) {
        alertTitle = title
        alertMessage = message
        showAlert = true
    }
}

#Preview {
    NavigationStack {
        SettingsRootView()
            .environmentObject(AppEnvironment())
    }
}
