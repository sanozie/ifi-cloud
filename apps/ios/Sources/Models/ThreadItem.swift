import Foundation

/// A conversation thread containing messages
struct ThreadItem: Identifiable, Codable, Hashable {
    /// Unique identifier
    let id: String
    
    /// Title of the thread
    let title: String
    
    /// Messages in the thread
    let messages: [Message]
    
    /// Timestamp when the thread was created
    let createdAt: Date
    
    /// Timestamp when the thread was last updated
    let updatedAt: Date
    
    /// Initialize a new thread
    init(id: String = UUID().uuidString,
         title: String,
         messages: [Message] = [],
         createdAt: Date = Date(),
         updatedAt: Date = Date()) {
        self.id = id
        self.title = title
        self.messages = messages
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
    
    /// Last active timestamp (same as updatedAt)
    var lastActiveAt: Date {
        return updatedAt
    }
    
    /// Preview of the last message
    var lastMessagePreview: String {
        guard let lastMessage = messages.last else {
            return "No messages"
        }
        
        return lastMessage.content
    }
    
    /// Number of messages in the thread
    var messageCount: Int {
        return messages.count
    }
    
    // MARK: - Sample Data
    
    /// Create sample thread data
    static func sampleData() -> [ThreadItem] {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        let twoDaysAgo = Calendar.current.date(byAdding: .day, value: -2, to: now)!
        
        return [
            ThreadItem(
                id: "thread-1",
                title: "GitHub Repository Analysis",
                messages: [
                    Message(id: "msg-1", role: .user, content: "Can you analyze my React component library?", createdAt: twoDaysAgo),
                    Message(id: "msg-2", role: .assistant, content: "I'd be happy to analyze your React component library. Could you please provide the repository URL?", createdAt: twoDaysAgo)
                ],
                createdAt: twoDaysAgo,
                updatedAt: twoDaysAgo
            ),
            ThreadItem(
                id: "thread-2",
                title: "Notion Database Integration",
                messages: [
                    Message(id: "msg-3", role: .user, content: "How can I integrate my Notion database with this app?", createdAt: yesterday),
                    Message(id: "msg-4", role: .assistant, content: "To integrate your Notion database, you'll need to set up a connection in the Settings tab. Would you like me to guide you through the process?", createdAt: yesterday)
                ],
                createdAt: yesterday,
                updatedAt: yesterday
            ),
            ThreadItem(
                id: "thread-3",
                title: "New Feature Implementation",
                messages: [
                    Message(id: "msg-5", role: .user, content: "I need to implement authentication in my Express app.", createdAt: now),
                    Message(id: "msg-6", role: .assistant, content: "I can help you implement authentication in your Express app. Are you looking to use JWT, session-based auth, or a third-party provider like Auth0?", createdAt: now)
                ],
                createdAt: now,
                updatedAt: now
            )
        ]
    }
}
