//
//  ChatViewModel.swift
//  Ifi
//
//  Created on 8/25/25.
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

/// Represents the role of a message sender
enum MessageRole: String, Codable {
    case user
    case assistant
    case system
    case tool
}

/// ViewModel responsible for managing chat state and interactions
@Observable
final class ChatViewModel {
    // MARK: - Published Properties
    
    /// Current messages in the active thread
    var messages: [ChatMessageViewModel] = []
    
    /// Text being composed by the user
    var inputText: String = ""
    
    /// Loading state for the chat interface
    var isLoading: Bool = false
    
    /// Error message to display, if any
    var errorMessage: String? = nil
    
    /// Whether an error alert should be shown
    var showError: Bool = false
    
    /// The current streaming response text (before it's committed as a message)
    var streamingResponse: String = ""
    
    /// Whether the assistant is currently streaming a response
    var isStreaming: Bool = false
    
    /// The active chat thread
    var currentThread: ThreadWithMessages?
    
    // MARK: - Private Properties
    
    /// API client for network requests
    private let apiClient: APIClient
    
    /// Set of cancellables for managing Combine subscriptions
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Initialization
    
    /// Initialize with dependencies
    /// - Parameters:
    ///   - apiClient: The API client for network requests
    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }
    
    // MARK: - Public Methods
    
    /// Load a thread by ID
    /// - Parameter threadId: The ID of the thread to load
    @MainActor
    func loadThread(id: String) async {
        isLoading = true
        errorMessage = nil
        
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
        
        isLoading = false
    }
    
    /// Send a message and handle the response
    /// - Parameter text: The message text to send
    func sendMessage() {
        guard !inputText.isEmpty else { return }
        guard !isLoading && !isStreaming else { return }
        
        // Capture the input text and clear the input field
        let messageText = inputText
        inputText = ""
        
        // Set loading state
        isLoading = true
        errorMessage = nil
        
        // Get thread ID if available
        let threadId = currentThread?.id
        
        // Add user message to the UI immediately
        let userMessage = ChatMessageViewModel(
            content: messageText,
            role: .user
        )
        messages.append(userMessage)
        
        // Create a placeholder for the assistant's response
        streamingResponse = ""
        isStreaming = true
        
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
        
        // If we have partial streaming response, add it to the UI
        if !streamingResponse.isEmpty {
            let assistantMessage = ChatMessageViewModel(
                content: streamingResponse,
                role: .assistant
            )
            messages.append(assistantMessage)
            streamingResponse = ""
        }
    }
    
    /// Retry sending the last user message
    func retryLastMessage() {
        guard let lastUserMessage = messages.last(where: { $0.role == .user }) else {
            return
        }
        
        // Set the input text to the last user message and send it
        inputText = lastUserMessage.content
        sendMessage()
    }
    
    // MARK: - Private Methods
    
    /// Handle an error
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
    
    /// Commit the streaming response as a permanent message in the UI
    private func commitStreamingResponse() {
        guard !streamingResponse.isEmpty else { return }
        
        // Add the assistant message to the UI
        let assistantMessage = ChatMessageViewModel(
            content: streamingResponse,
            role: .assistant
        )
        messages.append(assistantMessage)
        streamingResponse = ""
        
        // Refresh the thread to get the latest messages
        if let threadId = currentThread?.id {
            Task {
                await loadThread(id: threadId)
            }
        }
    }
}

// MARK: - StreamHandler Extension

extension ChatViewModel: StreamHandler {
    func handleChunk(_ text: String) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            // Append the chunk to the streaming response
            self.streamingResponse += text
            
            // Ensure loading state is false once streaming starts
            if self.isLoading {
                self.isLoading = false
            }
            
            // Ensure streaming flag is set
            self.isStreaming = true
        }
    }
    
    func handleCompletion() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            // Commit the streaming response as a permanent message
            self.commitStreamingResponse()
            
            // Reset states
            self.isLoading = false
            self.isStreaming = false
        }
    }
    
    func handleError(_ error: Error) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            
            // If we have partial streaming response, add it to the UI
            if !self.streamingResponse.isEmpty {
                self.commitStreamingResponse()
            }
            
            // Handle the error
            self.handleInternalError(error)
        }
    }
}
