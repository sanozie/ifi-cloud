import SwiftUI

/// Main tab view for the app
struct AppTabView: View {
    /// Environment for app-wide dependencies and settings
    @EnvironmentObject private var environment: AppEnvironment
    
    /// Currently selected thread ID
    @State private var selectedThreadId: String? = nil
    
    var body: some View {
        TabView {
            // Chat Tab
            NavigationStack {
                if let threadId = environment.appStore.selectedThreadId {
                    ChatView(threadId: threadId)
                } else if let firstThread = environment.appStore.threads.first {
                    ChatView(threadId: firstThread.id)
                } else {
                    ContentUnavailableView {
                        Label("No Conversations", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Start a new conversation to get help with coding tasks.")
                    } actions: {
                        Button {
                            let newThread = environment.appStore.createThread(title: "New Conversation")
                            environment.appStore.selectedThreadId = newThread.id
                        } label: {
                            Text("New Conversation")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                }
            }
            .tabItem {
                Label("Chat", systemImage: "bubble.left.fill")
            }
            
            // Threads Tab
            NavigationStack {
                ThreadListView()
            }
            .tabItem {
                Label("Threads", systemImage: "list.bullet")
            }
            
            // Settings Tab
            NavigationStack {
                SettingsRootView()
            }
            .tabItem {
                Label("Settings", systemImage: "gear")
            }
        }
        .environmentObject(environment)
    }
}

#Preview {
    AppTabView()
        .environmentObject(AppEnvironment())
}
