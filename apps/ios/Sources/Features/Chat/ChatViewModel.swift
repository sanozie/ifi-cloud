import Foundation
import SwiftUI
import Combine

/// View model for chat interface
@MainActor
final class ChatViewModel: ObservableObject {
    /// Messages in the thread
    @Published var messages: [Message] = []
    
    /// Text being entered by the user
    @Published var inputText: String = ""
    
    /// Flag indicating if a message is being sent
    @Published var isSending: Bool = false
    
    /// ID of the last job created
    @Published var lastJobId: String? = nil
    
    /// Current job status
    @Published var currentJob: Job? = nil
    
    /// Flag indicating if job polling is active
    @Published private(set) var isPollingJob: Bool = false
    
    /// Thread ID for this chat
    private let threadId: String
    
    /// API client for backend communication
    private let apiClient: APIClient
    
    /// App data store
    private let appStore: AppStore
    
    /// Auto-continue setting
    private let autoContinue: Bool
    
    /// Job polling task
    private var pollingTask: Task<Void, Never>? = nil
    
    /// Initialize with thread ID and environment
    init(threadId: String, environment: AppEnvironment) {
        self.threadId = threadId
        self.apiClient = APIClient(baseURL: environment.apiBaseURL)
        self.appStore = environment.appStore
        self.autoContinue = environment.autoContinue
        
        // Load messages from app store
        if let thread = appStore.getThread(id: threadId) {
            self.messages = thread.messages
            
            // Check for active job in the last assistant message
            if let lastAssistantMessage = thread.messages.last(where: { $0.role == .assistant }),
               let jobId = lastAssistantMessage.metadata?["jobId"] as? String,
               let jobStatus = lastAssistantMessage.metadata?["jobStatus"] as? String,
               jobStatus != JobStatus.complete.rawValue && jobStatus != JobStatus.failed.rawValue {
                self.lastJobId = jobId
                startPollingJob(jobId: jobId)
            }
        }
    }
    
    deinit {
        // Cancel any ongoing polling when view model is deallocated
        pollingTask?.cancel()
    }
    
    /// Send a message
    func send() async {
        guard !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        
        // Get message text and clear input
        let messageText = inputText
        inputText = ""
        
        // Set sending state
        isSending = true
        
        do {
            // Add user message to thread
            let userMessage = appStore.addMessage(
                threadId: threadId,
                role: .user,
                content: messageText
            )
            
            // Update local messages
            if let thread = appStore.getThread(id: threadId) {
                self.messages = thread.messages
            }
            
            // Send message to API
            let (jobId, reply) = try await apiClient.sendChat(
                threadId: threadId,
                message: messageText
            )
            
            // Add assistant message with reply
            let assistantMessage = appStore.addMessage(
                threadId: threadId,
                role: .assistant,
                content: reply ?? "Processing your request...",
                metadata: jobId != nil ? ["jobId": jobId as Any] : nil
            )
            
            // Update local messages
            if let thread = appStore.getThread(id: threadId) {
                self.messages = thread.messages
            }
            
            // Store job ID if available
            if let jobId = jobId {
                self.lastJobId = jobId
                
                // Start polling job status
                startPollingJob(jobId: jobId)
            }
        } catch {
            // Handle error
            print("Error sending message: \(error.localizedDescription)")
            
            // Add error message
            appStore.addMessage(
                threadId: threadId,
                role: .assistant,
                content: "Error: \(error.localizedDescription)"
            )
            
            // Update local messages
            if let thread = appStore.getThread(id: threadId) {
                self.messages = thread.messages
            }
        }
        
        // Reset sending state
        isSending = false
    }
    
    /// Start polling job status
    private func startPollingJob(jobId: String) {
        // Cancel any existing polling task
        pollingTask?.cancel()
        
        // Set polling state
        isPollingJob = true
        
        // Create new polling task
        pollingTask = Task {
            // Initial delay before first poll
            try? await Task.sleep(nanoseconds: 1_000_000_000) // 1 second
            
            // Poll until job is complete or task is cancelled
            while !Task.isCancelled {
                do {
                    // Get job status from API
                    let job = try await apiClient.getJob(id: jobId)
                    
                    // Update current job
                    self.currentJob = job
                    
                    // Find message with this job ID
                    if let thread = appStore.getThread(id: threadId),
                       let messageIndex = thread.messages.firstIndex(where: { 
                           $0.metadata?["jobId"] as? String == jobId 
                       }) {
                        // Update job status in app store
                        appStore.updateJobStatus(
                            threadId: threadId,
                            messageId: thread.messages[messageIndex].id,
                            jobId: jobId,
                            status: job.status,
                            prUrl: job.prUrl
                        )
                        
                        // Update local messages
                        self.messages = thread.messages
                    }
                    
                    // Stop polling if job is complete or failed
                    if job.status == .complete || job.status == .failed {
                        isPollingJob = false
                        break
                    }
                    
                    // Wait before next poll
                    try await Task.sleep(nanoseconds: 2_000_000_000) // 2 seconds
                } catch {
                    print("Error polling job status: \(error.localizedDescription)")
                    
                    // Wait before retrying
                    try? await Task.sleep(nanoseconds: 5_000_000_000) // 5 seconds
                }
            }
            
            // Reset polling state
            isPollingJob = false
        }
    }
    
    /// Stop polling job status
    func stopPollingJob() {
        pollingTask?.cancel()
        pollingTask = nil
        isPollingJob = false
    }
    
    /// Record and transcribe speech
    func recordSpeech(sttService: STTService) {
        sttService.startRecording { [weak self] transcription in
            guard let self = self else { return }
            
            // Only update input text if it's not "Listening..."
            if transcription != "Listening..." {
                self.inputText = transcription
                
                // Auto-send if auto-continue is enabled
                if self.autoContinue {
                    Task {
                        await self.send()
                    }
                }
            }
        }
    }
}
