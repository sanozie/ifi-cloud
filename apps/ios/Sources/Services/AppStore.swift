import Foundation
import Combine

/// In-memory store for app data
class AppStore: ObservableObject {
    /// All conversation threads
    @Published var threads: [ThreadItem] = []
    
    /// Currently selected thread ID
    @Published var selectedThreadId: String?
    
    /// Initialize with sample data in debug, empty in production
    init() {
        #if DEBUG
        // Load sample data in debug builds
        self.threads = ThreadItem.sampleData()
        self.selectedThreadId = threads.first?.id
        #endif
    }
    
    /// Create a new thread
    /// - Parameter title: Thread title
    /// - Returns: The created thread
    @discardableResult
    func createThread(title: String) -> ThreadItem {
        let newThread = ThreadItem(
            title: title,
            messages: [],
            createdAt: Date(),
            updatedAt: Date()
        )
        
        threads.insert(newThread, at: 0)
        
        // Notify observers of thread changes
        NotificationCenter.default.post(name: Notification.Name("AppStoreThreadsChanged"), object: nil)
        
        return newThread
    }
    
    /// Add a message to a thread
    /// - Parameters:
    ///   - threadId: Thread ID
    ///   - role: Message role (user, assistant, system)
    ///   - content: Message content
    ///   - metadata: Optional metadata
    /// - Returns: The created message
    @discardableResult
    func addMessage(
        threadId: String,
        role: MessageRole,
        content: String,
        metadata: [String: AnyHashable]? = nil
    ) -> Message? {
        // Find thread index
        guard let threadIndex = threads.firstIndex(where: { $0.id == threadId }) else {
            return nil
        }
        
        // Create new message
        let newMessage = Message(
            role: role,
            content: content,
            metadata: metadata
        )
        
        // Create updated thread with new message
        var updatedMessages = threads[threadIndex].messages
        updatedMessages.append(newMessage)
        
        let updatedThread = ThreadItem(
            id: threads[threadIndex].id,
            title: threads[threadIndex].title,
            messages: updatedMessages,
            createdAt: threads[threadIndex].createdAt,
            updatedAt: Date()
        )
        
        // Update thread in array
        threads[threadIndex] = updatedThread
        
        // Notify observers of thread changes
        NotificationCenter.default.post(name: Notification.Name("AppStoreThreadsChanged"), object: nil)
        
        return newMessage
    }
    
    /// Update job status for a message
    /// - Parameters:
    ///   - threadId: Thread ID
    ///   - messageId: Message ID
    ///   - jobId: Job ID
    ///   - status: New job status
    ///   - prUrl: Optional PR URL
    func updateJobStatus(
        threadId: String,
        messageId: String,
        jobId: String,
        status: JobStatus,
        prUrl: String? = nil
    ) {
        // Find thread index
        guard let threadIndex = threads.firstIndex(where: { $0.id == threadId }) else {
            return
        }
        
        // Find message index
        guard let messageIndex = threads[threadIndex].messages.firstIndex(where: { $0.id == messageId }) else {
            return
        }
        
        // Create updated metadata
        var metadata = threads[threadIndex].messages[messageIndex].metadata ?? [:]
        metadata["jobId"] = jobId
        metadata["jobStatus"] = status.rawValue
        
        if let prUrl = prUrl {
            metadata["prUrl"] = prUrl
        }
        
        // Create updated message
        let updatedMessage = Message(
            id: messageId,
            role: threads[threadIndex].messages[messageIndex].role,
            content: threads[threadIndex].messages[messageIndex].content,
            createdAt: threads[threadIndex].messages[messageIndex].createdAt,
            metadata: metadata
        )
        
        // Create updated messages array
        var updatedMessages = threads[threadIndex].messages
        updatedMessages[messageIndex] = updatedMessage
        
        // Create updated thread
        let updatedThread = ThreadItem(
            id: threads[threadIndex].id,
            title: threads[threadIndex].title,
            messages: updatedMessages,
            createdAt: threads[threadIndex].createdAt,
            updatedAt: Date()
        )
        
        // Update thread in array
        threads[threadIndex] = updatedThread
        
        // Notify observers of thread changes
        NotificationCenter.default.post(name: Notification.Name("AppStoreThreadsChanged"), object: nil)
    }
    
    /// Get a thread by ID
    /// - Parameter id: Thread ID
    /// - Returns: Thread if found, nil otherwise
    func getThread(id: String) -> ThreadItem? {
        return threads.first { $0.id == id }
    }
    
    /// Delete a thread
    /// - Parameter id: Thread ID
    func deleteThread(id: String) {
        threads.removeAll { $0.id == id }
        
        // If deleted thread was selected, clear selection
        if selectedThreadId == id {
            selectedThreadId = threads.first?.id
        }
        
        // Notify observers of thread changes
        NotificationCenter.default.post(name: Notification.Name("AppStoreThreadsChanged"), object: nil)
    }
}
