//
//  ThreadListViewModel.swift
//  Ifi
//
//  Created on 8/25/25.
//

import Foundation
import Observation
import SwiftUI

/// ViewModel responsible for managing thread list state and interactions with the API
@Observable
final class ThreadListViewModel {
    // MARK: - State Properties
    
    /// Threads fetched from the API
    var threads: [ThreadResponse] = []
    
    /// Loading state for the thread list
    var isLoading: Bool = false
    
    /// Error message to display, if any
    var errorMessage: String? = nil
    
    /// Whether an error alert should be shown
    var showError: Bool = false
    
    /// Whether the thread creation sheet is presented
    var isCreatingThread: Bool = false
    
    /// Title for the new thread being created
    var newThreadTitle: String = ""
    
    // MARK: - Private Properties
    
    /// API client for network requests
    private let _apiClient: APIClient
    
    // MARK: - Public Properties
    
    /// Public accessor for the API client
    var apiClient: APIClient {
        return _apiClient
    }
    
    // MARK: - Initialization
    
    /// Initialize with dependencies
    /// - Parameter apiClient: The API client for network requests
    init(apiClient: APIClient) {
        self._apiClient = apiClient
    }
    
    // MARK: - Public Methods
    
    /// Fetch all threads from the API
    @MainActor
    func fetchThreads() async {
        // Set loading state
        isLoading = true
        errorMessage = nil
        showError = false
        
        do {
            // Fetch threads from the API
            threads = try await _apiClient.fetchThreads()
        } catch {
            // Handle error
            handleError(error)
        }
        
        // Reset loading state
        isLoading = false
    }
    
    /// Create a new thread
    /// - Parameter title: The title for the new thread
    /// - Returns: The ID of the newly created thread, if successful
    @MainActor
    func createNewThread(title: String) async -> String? {
        guard !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        
        isLoading = true
        errorMessage = nil
        // Ensure loading flag is cleared on every exit path
        defer { isLoading = false }
        
        do {
            // Send a message to create a new thread
            // The API creates a thread when sending the first message
            let initialMessage = "Hello! I'd like to discuss \(title)"
            
            var threadId: String? = nil
            
            // Use the streaming API to send the initial message
            // This will create a new thread with the given title
            for try await _ in _apiClient.sendChatMessageAsync(message: initialMessage) {
                // We're just waiting for the stream to complete
                // The threadId will be in the response after completion
            }
            
            // Refresh threads to get the newly created thread
            await fetchThreads()
            
            // Find the newly created thread (should be the first one)
            if let newThread = threads.first {
                threadId = newThread.id
            }
            
            return threadId
        } catch {
            handleError(error)
            return nil
        }
    }
    
    /// Delete a thread
    /// - Parameter id: The ID of the thread to delete
    @MainActor
    func deleteThread(id: String) async {
        isLoading = true
        errorMessage = nil
        
        do {
            // Delete the thread via API
            try await _apiClient.deleteThread(id: id)
            
            // Remove the thread from the local array
            threads.removeAll { $0.id == id }
        } catch {
            handleError(error)
        }
        
        isLoading = false
    }
    
    /// Refresh the thread list
    @MainActor
    func refresh() async {
        await fetchThreads()
    }
    
    // MARK: - Private Methods
    
    /// Handle an error
    /// - Parameter error: The error to handle
    private func handleError(_ error: Error) {
        // Set error message based on the error type
        if let apiError = error as? APIError {
            errorMessage = apiError.localizedDescription
        } else {
            errorMessage = error.localizedDescription
        }
        
        showError = true
    }
}
