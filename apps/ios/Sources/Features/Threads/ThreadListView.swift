import SwiftUI

/// View model for thread list
@MainActor
final class ThreadListViewModel: ObservableObject {
    /// All threads
    @Published var threads: [ThreadItem] = []
    
    /// Search query
    @Published var searchQuery: String = ""
    
    /// App data store
    private let appStore: AppStore
    
    /// Filtered threads based on search query
    var filteredThreads: [ThreadItem] {
        if searchQuery.isEmpty {
            return threads
        }
        
        return threads.filter { thread in
            thread.title.localizedCaseInsensitiveContains(searchQuery) ||
            thread.messages.contains { message in
                message.content.localizedCaseInsensitiveContains(searchQuery)
            }
        }
    }
    
    /// Initialize with app store
    init(appStore: AppStore) {
        self.appStore = appStore
        self.threads = appStore.threads
        
        // Set up observation of app store threads
        Task {
            for await _ in NotificationCenter.default.notifications(named: .init("AppStoreThreadsChanged")) {
                self.threads = appStore.threads
            }
        }
    }
    
    /// Create a new thread
    func createNewThread() {
        let newThread = appStore.createThread(title: "New Conversation")
        appStore.selectedThreadId = newThread.id
    }
    
    /// Select a thread
    func selectThread(_ thread: ThreadItem) {
        appStore.selectedThreadId = thread.id
    }
}

/// List view for all conversation threads
struct ThreadListView: View {
    /// View model
    @StateObject private var viewModel: ThreadListViewModel
    
    /// Environment
    @EnvironmentObject private var environment: AppEnvironment
    
    /// Initialize with dependencies
    init() {
        _viewModel = StateObject(wrappedValue: ThreadListViewModel(appStore: AppEnvironment().appStore))
    }
    
    var body: some View {
        List {
            ForEach(viewModel.filteredThreads) { thread in
                NavigationLink(destination: ChatView(threadId: thread.id)) {
                    ThreadRow(thread: thread)
                }
                .swipeActions {
                    Button(role: .destructive) {
                        // Delete thread functionality would go here
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
            .listRowSeparator(.visible)
        }
        .navigationTitle("Threads")
        .searchable(text: $viewModel.searchQuery, prompt: "Search conversations")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    viewModel.createNewThread()
                } label: {
                    Label("New Thread", systemImage: "plus")
                }
            }
        }
        .overlay {
            if viewModel.threads.isEmpty {
                ContentUnavailableView {
                    Label("No Conversations", systemImage: "bubble.left.and.bubble.right")
                } description: {
                    Text("Start a new conversation to get help with coding tasks, GitHub repositories, or Notion workspaces.")
                } actions: {
                    Button {
                        viewModel.createNewThread()
                    } label: {
                        Text("New Conversation")
                    }
                    .buttonStyle(.borderedProminent)
                }
            } else if viewModel.filteredThreads.isEmpty {
                ContentUnavailableView.search
            }
        }
        .onAppear {
            // Update threads from app store
            viewModel.threads = environment.appStore.threads
        }
    }
}

/// Row view for a single thread
struct ThreadRow: View {
    /// Thread to display
    let thread: ThreadItem
    
    /// Date formatter for relative time
    private let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter
    }()
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(thread.title)
                    .font(.headline)
                    .lineLimit(1)
                
                Spacer()
                
                Text(relativeFormatter.localizedString(for: thread.lastActiveAt, relativeTo: Date()))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            Text(thread.lastMessagePreview)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            
            HStack {
                Label("\(thread.messageCount) messages", systemImage: "bubble.left.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                
                Spacer()
                
                if thread.messages.last?.role == .assistant {
                    Label("Assistant", systemImage: "sparkles")
                        .font(.caption)
                        .foregroundStyle(.blue)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NavigationStack {
        ThreadListView()
            .environmentObject(AppEnvironment())
    }
}
