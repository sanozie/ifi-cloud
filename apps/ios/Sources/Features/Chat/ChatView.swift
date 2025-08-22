import SwiftUI

/// Main chat view for a conversation thread
struct ChatView: View {
    /// Thread ID for this chat
    let threadId: String
    
    /// View model
    @StateObject private var viewModel: ChatViewModel
    
    /// Environment
    @EnvironmentObject private var environment: AppEnvironment
    
    /// Speech-to-text service
    @StateObject private var sttService = STTService()
    
    /// Scroll view reader for scrolling to bottom
    @Namespace private var bottomID
    
    /// Initialize with thread ID
    init(threadId: String) {
        self.threadId = threadId
        _viewModel = StateObject(wrappedValue: ChatViewModel(
            threadId: threadId,
            environment: AppEnvironment()
        ))
    }
    
    var body: some View {
        VStack(spacing: 0) {
            // Job status banner
            if let job = viewModel.currentJob {
                JobStatusBanner(job: job)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
            
            // Messages list
            ScrollViewReader { scrollView in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(viewModel.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                        
                        // Invisible view at bottom for scrolling
                        Color.clear
                            .frame(height: 1)
                            .id(bottomID)
                    }
                    .padding(.horizontal)
                    .padding(.top, 12)
                    .padding(.bottom, 8)
                }
                .onChange(of: viewModel.messages.count) { _ in
                    // Scroll to bottom when messages change
                    withAnimation {
                        scrollView.scrollTo(bottomID, anchor: .bottom)
                    }
                }
                .onAppear {
                    // Scroll to bottom when view appears
                    scrollView.scrollTo(bottomID, anchor: .bottom)
                }
            }
            
            // Typing indicator
            if viewModel.isSending {
                HStack {
                    Text("IFI is typing")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    // Animated dots
                    TypingIndicator()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color(.systemBackground))
            }
            
            // Input bar
            InputBar(
                text: $viewModel.inputText,
                isSending: viewModel.isSending,
                onSend: {
                    Task {
                        await viewModel.send()
                    }
                },
                onRecord: {
                    viewModel.recordSpeech(sttService: sttService)
                },
                isRecording: sttService.isRecording
            )
        }
        .navigationTitle(getThreadTitle())
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            // Use environment from parent view
            if let env = (UIApplication.shared.connectedScenes.first as? UIWindowScene)?.windows.first?.rootViewController?.view.window?.windowScene?.windows.first?.rootViewController as? UIHostingController<AppTabView> {
                if let appEnv = Mirror(reflecting: env.rootView).descendant("_environment") as? AppEnvironment {
                    viewModel.environment = appEnv
                }
            }
        }
    }
    
    /// Get thread title from app store
    private func getThreadTitle() -> String {
        return environment.appStore.getThread(id: threadId)?.title ?? "Chat"
    }
}

/// Typing indicator animation
struct TypingIndicator: View {
    @State private var showFirstDot = false
    @State private var showSecondDot = false
    @State private var showThirdDot = false
    
    var body: some View {
        HStack(spacing: 2) {
            Circle()
                .frame(width: 4, height: 4)
                .scaleEffect(showFirstDot ? 1 : 0.5)
                .opacity(showFirstDot ? 1 : 0.5)
            
            Circle()
                .frame(width: 4, height: 4)
                .scaleEffect(showSecondDot ? 1 : 0.5)
                .opacity(showSecondDot ? 1 : 0.5)
            
            Circle()
                .frame(width: 4, height: 4)
                .scaleEffect(showThirdDot ? 1 : 0.5)
                .opacity(showThirdDot ? 1 : 0.5)
        }
        .foregroundColor(.secondary)
        .onAppear {
            startAnimation()
        }
    }
    
    private func startAnimation() {
        withAnimation(Animation.easeInOut(duration: 0.4).repeatForever(autoreverses: true)) {
            showFirstDot = true
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            withAnimation(Animation.easeInOut(duration: 0.4).repeatForever(autoreverses: true)) {
                showSecondDot = true
            }
        }
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            withAnimation(Animation.easeInOut(duration: 0.4).repeatForever(autoreverses: true)) {
                showThirdDot = true
            }
        }
    }
}

/// Message bubble component
struct MessageBubble: View {
    let message: Message
    
    var body: some View {
        HStack {
            if message.role == .user {
                Spacer()
            }
            
            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .padding(12)
                    .background(message.role == .user ? Color.blue : Color(.systemGray6))
                    .foregroundColor(message.role == .user ? .white : .primary)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                
                // Show job metadata if present
                if let metadata = message.metadata,
                   let jobId = metadata["jobId"] as? String,
                   let jobStatus = metadata["jobStatus"] as? String {
                    HStack {
                        Text("Job: \(jobStatus)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        
                        if let prUrl = metadata["prUrl"] as? String {
                            Link("View PR", destination: URL(string: prUrl)!)
                                .font(.caption2)
                        }
                    }
                    .padding(.horizontal, 8)
                }
                
                // Timestamp
                Text(formatTimestamp(message.createdAt))
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 8)
            }
            
            if message.role == .assistant {
                Spacer()
            }
        }
    }
    
    private func formatTimestamp(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}

/// Job status banner component
struct JobStatusBanner: View {
    let job: Job
    
    var body: some View {
        HStack {
            // Status icon
            statusIcon
                .foregroundColor(statusColor)
            
            // Status text
            VStack(alignment: .leading, spacing: 2) {
                Text(job.statusDescription)
                    .font(.subheadline)
                    .fontWeight(.medium)
                
                if let repo = job.repo.components(separatedBy: "/").last {
                    Text("Repository: \(repo)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            
            Spacer()
            
            // PR link if available
            if let prUrl = job.prUrl, let url = URL(string: prUrl) {
                Link(destination: url) {
                    Label("View PR", systemImage: "arrow.up.forward.square")
                        .font(.caption)
                        .foregroundColor(.blue)
                }
            }
        }
        .padding()
        .background(statusColor.opacity(0.1))
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(statusColor.opacity(0.3)),
            alignment: .bottom
        )
    }
    
    /// Icon for current status
    private var statusIcon: some View {
        Group {
            switch job.status {
            case .queued:
                Image(systemName: "clock")
            case .planning:
                Image(systemName: "brain")
            case .codegen:
                Image(systemName: "chevron.left.forwardslash.chevron.right")
            case .apply:
                Image(systemName: "hammer")
            case .test:
                Image(systemName: "checklist")
            case .pr_open:
                Image(systemName: "arrow.triangle.branch")
            case .complete:
                Image(systemName: "checkmark.circle")
            case .failed:
                Image(systemName: "exclamationmark.triangle")
            }
        }
        .font(.title3)
    }
    
    /// Color for current status
    private var statusColor: Color {
        switch job.status {
        case .queued, .planning, .codegen, .apply, .test:
            return .blue
        case .pr_open:
            return .purple
        case .complete:
            return .green
        case .failed:
            return .red
        }
    }
}

/// Input bar component
struct InputBar: View {
    @Binding var text: String
    let isSending: Bool
    let onSend: () -> Void
    let onRecord: () -> Void
    let isRecording: Bool
    
    var body: some View {
        VStack(spacing: 0) {
            Divider()
            
            HStack(spacing: 12) {
                // Voice button
                Button(action: onRecord) {
                    Image(systemName: isRecording ? "stop.circle.fill" : "mic.circle")
                        .font(.system(size: 24))
                        .foregroundColor(isRecording ? .red : .blue)
                }
                .disabled(isSending)
                
                // Text field
                TextField("Message", text: $text, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...5)
                    .disabled(isSending || isRecording)
                
                // Send button
                Button(action: onSend) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 24))
                        .foregroundColor(.blue)
                }
                .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSending || isRecording)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
            .background(Color(.systemBackground))
        }
    }
}

#Preview {
    NavigationStack {
        ChatView(threadId: "preview-thread")
            .environmentObject(AppEnvironment())
    }
}
