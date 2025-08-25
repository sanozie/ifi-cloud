//
//  ThreadListView.swift
//  Ifi
//
//  Created on 8/25/25.
//

import SwiftUI

struct ThreadListView: View {
    // MARK: - Properties
    
    @Environment(\.colorScheme) private var colorScheme
    
    // ViewModel for API-based thread management
    @State private var viewModel: ThreadListViewModel
    
    @State private var navigationPath = NavigationPath()
    
    // MARK: - Initialization
    
    init(apiClient: APIClient) {
        // Initialize the view model with the API client
        self._viewModel = State(initialValue: ThreadListViewModel(apiClient: apiClient))
    }
    
    // MARK: - Body
    
    var body: some View {
        NavigationStack(path: $navigationPath) {
            List {
                ForEach(viewModel.threads) { thread in
                    NavigationLink(value: thread.id) {
                        ThreadRow(thread: thread)
                    }
                    .accessibilityLabel("Chat thread: \(thread.title)")
                    .accessibilityHint("Last updated \(thread.updatedAt.formatted(date: .abbreviated, time: .shortened))")
                    .swipeActions(edge: .trailing) {
                        Button(role: .destructive) {
                            Task {
                                await viewModel.deleteThread(id: thread.id)
                            }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                        .tint(.red)
                    }
                }
            }
            .listStyle(.inset)
            .navigationTitle("Chats")
            .navigationDestination(for: String.self) { threadId in
                // Pass the thread ID to the chat view
                if let thread = viewModel.threads.first(where: { $0.id == threadId }) {
                    chatView(for: thread)
                }
            }
            // Standard toolbar modifier for broad compatibility
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        viewModel.isCreatingThread = true
                    } label: {
                        Label("New Chat", systemImage: "square.and.pencil")
                    }
                    .buttonStyle(.borderedProminent)
                    .sensoryFeedback(.selection, trigger: true)
                }
            }
            .refreshable {
                await viewModel.refresh()
            }
            .overlay {
                if viewModel.threads.isEmpty && !viewModel.isLoading {
                    ContentUnavailableView {
                        Label("No Chats", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text("Start a new conversation by tapping the button in the top right.")
                    } actions: {
                        Button {
                            viewModel.isCreatingThread = true
                        } label: {
                            Text("New Chat")
                        }
                        .buttonStyle(.borderedProminent)
                        .sensoryFeedback(.selection, trigger: true)
                    }
                    .accessibilityLabel("No chat threads available")
                }
            }
            
            // Loading overlay
            if viewModel.isLoading {
                ProgressView()
                    .scaleEffect(1.5)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black.opacity(0.1))
                    .ignoresSafeArea()
                    .accessibilityLabel("Loading threads")
            }
        }
        .alert("New Chat", isPresented: $viewModel.isCreatingThread) {
            TextField("Chat Title", text: $viewModel.newThreadTitle)
                .accessibilityLabel("Enter chat title")
            
            Button("Cancel", role: .cancel) {
                viewModel.newThreadTitle = ""
            }
            
            Button("Create") {
                Task {
                    if let threadId = await viewModel.createNewThread(title: viewModel.newThreadTitle) {
                        // Navigate to the new thread
                        navigationPath.append(threadId)
                    }
                }
            }
            .disabled(viewModel.newThreadTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .sensoryFeedback(.success, trigger: !viewModel.newThreadTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } message: {
            Text("Enter a title for your new chat.")
        }
        .alert("Error", isPresented: $viewModel.showError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(viewModel.errorMessage ?? "An unknown error occurred")
        }
        .scrollDismissesKeyboard(.immediately)
        .task {
            // Fetch threads when the view appears
            await viewModel.fetchThreads()
        }
    }
    
    // MARK: - Helper Methods
    
    /// Creates a configured ChatView for the given thread
    private func chatView(for thread: ThreadResponse) -> some View {
        // Create a view that will load the thread details from the API
        ThreadDetailView(threadId: thread.id, apiClient: viewModel.apiClient)
    }
}

// MARK: - Thread Row View

struct ThreadRow: View {
    let thread: ThreadResponse
    @Environment(\.colorScheme) private var colorScheme
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(thread.title)
                    .font(.headline)
                    .lineLimit(1)
                
                Spacer()
                
                Text(thread.updatedAt.formatted(date: .omitted, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            Text(thread.lastMessage?.content ?? "No messages")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}

// MARK: - Thread Detail View

struct ThreadDetailView: View {
    let threadId: String
    let apiClient: APIClient
    @State private var isLoading = true
    @State private var thread: ThreadWithMessages?
    @State private var chatViewModel: ChatViewModel?
    @State private var errorMessage: String?
    
    var body: some View {
        Group {
            if let thread = thread {
                // When the thread data is available ensure we have a view-model
                if let vm = chatViewModel {
                    ChatView(viewModel: vm)
                } else {
                    ProgressView("Preparing chat…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .task {
                            await prepareChatViewModel(with: thread)
                        }
                }
            } else if isLoading {
                ProgressView("Loading conversation...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage = errorMessage {
                ContentUnavailableView {
                    Label("Error", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Retry") {
                        Task {
                            await loadThread()
                        }
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .task {
            await loadThread()
        }
    }
    
    @MainActor
    private func loadThread() async {
        isLoading = true
        errorMessage = nil
        
        do {
            thread = try await apiClient.fetchThread(id: threadId)
        } catch {
            if let apiError = error as? APIError {
                errorMessage = apiError.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
        }
        
        isLoading = false
    }

    /// Create the ChatViewModel and load messages once thread meta is fetched
    @MainActor
    private func prepareChatViewModel(with thread: ThreadWithMessages) async {
        // Prevent duplicate creation on multiple task invocations
        guard chatViewModel == nil else { return }
        let vm = ChatViewModel(apiClient: apiClient)
        chatViewModel = vm
        await vm.loadThread(id: thread.id)
    }
}

// MARK: - Preview

#Preview {
    // Create a mock API client for preview
    let apiClient = APIClient(baseURLString: "https://example.com")
    
    // Return the view with the mock client
    return ThreadListView(apiClient: apiClient)
        .preferredColorScheme(.dark)
}
