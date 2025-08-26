//
//  ChatViewModelNew.swift
//  Ifi
//
//  Created on 8/26/25.
//

import Foundation
import Combine
import SwiftUI
import Observation

/// Message model for UI display
struct ChatMessageViewModel: Identifiable {
    let id: String
    let content: String
    let role: MessageRole
    let timestamp: Date
    
    /// Returns true if the message is from the assistant
    var isFromAssistant: Bool {
        return role == .assistant
    }
    
    /// Returns true if the message is from the user
    var isFromUser: Bool {
        return role == .user
    }
    
    /// Returns a formatted time string for display
    var formattedTime: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: timestamp)
    }
    
    /// Create from API response
    init(from response: MessageResponse) {
        self.id = response.id
        self.content = response.content
        self.role = MessageRole(rawValue: response.role) ?? .user
        self.timestamp = response.createdAt
    }
    
    /// Create a new message
    init(id: String = UUID().uuidString, content: String, role: MessageRole, timestamp: Date = Date()) {
        self.id = id
        self.content = content
        self.role = role
        self.timestamp = timestamp
    }
}

/// Message roles
enum MessageRole: String {
    case user
    case assistant
    case system
    case tool
}

/// ViewModel responsible for managing chat state and interactions
@MainActor
@Observable
final class ChatViewModel {
    // MARK: - Public Properties
    
    /// Current user input text
    var inputText: String = ""
    
    /// List of messages in the conversation
    var messages: [ChatMessageViewModel] = []
    
    /// Whether the chat is currently loading
    var isLoading: Bool = false
    
    /// Whether a response is currently streaming
    var isStreaming: Bool = false
    
    /// Error message to display
    var errorMessage: String? = nil
    
    /// Whether to show the error alert
    var showError: Bool = false
    
    /// The structured stream content for the current response
    var streamContent: StreamContent = {
        // Start in a “finished” state so `isStreaming` resolves to `false`
        var content = StreamContent()
        content.finished = true
        return content
    }()
    
    /// The active chat thread
    var currentThread: ThreadWithMessages?
    
    // MARK: - Private Properties
    
    /// API client for network requests
    private let apiClient: APIClient
    
    /// Stream controller for managing content streaming
    private let streamController = StreamController()
    
    /// Set of cancellables for managing Combine subscriptions
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Initialization
    
    /// Initialize with dependencies
    /// - Parameters:
    ///   - apiClient: The API client for network requests
    init(apiClient: APIClient) {
        self.apiClient = apiClient
        
        // Subscribe to the stream controller's output
        streamController.output
            .sink { [weak self] content in
                self?.handleStreamContent(content)
            }
            .store(in: &cancellables)
        
        // Subscribe to error notifications
        streamController.errorPublisher()
            .sink { [weak self] error in
                self?.handleStreamError(error)
            }
            .store(in: &cancellables)
    }
    
    // MARK: - Public Methods
    
    /// Load a thread by ID
    /// - Parameter id: The ID of the thread to load
    @MainActor
    func loadThread(id: String) async {
        isLoading = true
        errorMessage = nil
        // Always reset loading state on exit – success, failure, or cancellation
        defer { isLoading = false }
        
        do {
            // Fetch the thread from the API
            let thread = try await apiClient.fetchThread(id: id)
            currentThread = thread
            
            // Convert API messages to view models
            messages = thread.messages.map { ChatMessageViewModel(from: $0) }
                .sorted { $0.timestamp < $1.timestamp }
            
        } catch {
            handleInternalError(error)
        }
    }
    
    // MARK: - Refresh Support
    
    /// Reload the currently-open thread from the API
    ///  – Gracefully does nothing when no active thread is set
    ///  – Mirrors `loadThread(id:)` behaviour for loading / error handling
    @MainActor
    func refresh() async {
        // Ensure we actually have a thread to refresh
        guard let threadId = currentThread?.id else { return }
        
        // Show a temporary loading indicator
        isLoading = true
        errorMessage = nil
        
        await loadThread(id: threadId)
    }
    
    /// Send a message and handle the response
    func sendMessage() {
        guard !inputText.isEmpty else { return }
        guard !isLoading && !isStreaming else { return }
        
        // Capture the input text and clear the input field
        let messageText = inputText
        inputText = ""
        
        // Set loading state
        isLoading = true
        errorMessage = nil
        
        // Reset stream controller
        streamController.reset()
        streamContent = StreamContent()
        
        // Get thread ID if available
        let threadId = currentThread?.id
        
        // Add the user message to the UI
        let userMessage = ChatMessageViewModel(
            content: messageText,
            role: .user
        )
        messages.append(userMessage)
        
        // Set streaming state
        isStreaming = true
        
        // Debug log for outbound request
        print("[STREAM-DEBUG] ➡️  sendMessage() – initiating API call. textLen=\(messageText.count) threadId=\(threadId ?? "nil")")

        // Send the message to the API
        apiClient.sendChatMessage(
            message: messageText,
            threadId: threadId,
            handler: self
        )
    }
    
    /// Cancel the current streaming response
    func cancelStreaming() {
        apiClient.cancelCurrentRequest()
        isStreaming = false
        
        // If we have partial content, add it to the UI
        if !streamContent.items.isEmpty {
            commitStreamingResponse()
        }
    }
    
    // MARK: - Private Methods
    
    /// Handle a new stream content update
    /// - Parameter content: The updated stream content
    private func handleStreamContent(_ content: StreamContent) {
#if DEBUG
        print("[STREAM-DEBUG] 📥 handleStreamContent() – items=\(content.items.count) finished=\(content.finished)")
#endif
        streamContent = content
        
        // Update UI state based on content
        if isLoading {
            isLoading = false
        }
        
        // Update streaming flag only for meaningful updates
        isStreaming = !content.finished
        
        // If streaming is complete, commit the response
        if content.finished {
            commitStreamingResponse()
        }
    }
    
    /// Handle a stream error
    /// - Parameter error: The error that occurred
    private func handleStreamError(_ error: IdentifiableError) {
        // Log the error
        print("Stream error: \(error.localizedDescription)")
        
        // Only show UI errors for critical failures
        if !isStreaming || streamContent.items.isEmpty {
            handleInternalError(error.underlyingError)
        }
    }
    
    /// Handle internal errors
    /// - Parameter error: The error to handle
    private func handleInternalError(_ error: Error) {
        isLoading = false
        isStreaming = false
        
        // Set error message based on the error type
        if let apiError = error as? APIError {
            errorMessage = apiError.localizedDescription
        } else {
            errorMessage = error.localizedDescription
        }
        
        showError = true
    }
    
    /// Commit the current streaming response as a permanent message
    private func commitStreamingResponse() {
        // Skip if there's no content
        guard !streamContent.items.isEmpty else { return }
        
        // Extract the markdown content from stream items
        var responseText = ""

#if DEBUG
        print("[STREAM-DEBUG] 📝 commitStreamingResponse() – committing \(streamContent.items.count) items")
#endif
        
        for item in streamContent.items {
            switch item.value {
            case .markdown(let entry):
                responseText += entry.content
            case .markdownTable(let table):
                responseText += table.content
            case .codeBlock(let codeBlock):
                responseText += "```\(codeBlock.language ?? "")\n\(codeBlock.code)\n```"
            case .xml:
                // Skip XML content
                break
            }
        }
        
        // Add the assistant message to the UI
        let assistantMessage = ChatMessageViewModel(
            content: responseText,
            role: .assistant
        )
        messages.append(assistantMessage)
        
        // Reset streaming state
        // Ensure the new stream content starts in a *finished* state so that
        // `isStreaming` evaluates to `false` immediately after committing.
        streamContent = {
            var content = StreamContent()
            content.finished = true
            return content
        }()
        isStreaming = false
    }
}

// MARK: - StreamHandler Extension

extension ChatViewModel: StreamHandler {
    func handleChunk(_ text: String) {
        // Process the chunk through the stream controller
        streamController.processChunk(text)
        
        // Ensure streaming flag is set
        isStreaming = true

#if DEBUG
        print("[STREAM-DEBUG] 🔄 handleChunk() – received chunk len=\(text.count)")
#endif
    }
    
    func handleCompletion() {
        // Mark the stream as finished
        isStreaming = false

#if DEBUG
        print("[STREAM-DEBUG] ✅ handleCompletion() – stream finished")
#endif
    }
    
    func handleError(_ error: Error) {
        // Add the error to the stream controller
        streamController.addError(error)
        
        // If we have partial content, add it to the UI
        if !streamContent.items.isEmpty {
            commitStreamingResponse()
        }
        
        // Reset states
        isLoading = false
        isStreaming = false
        
        // Handle the error
        handleInternalError(error)

#if DEBUG
        print("[STREAM-DEBUG] ❌ handleError() – \(error.localizedDescription)")
#endif
    }
}
