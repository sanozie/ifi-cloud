import Foundation

/// Status of a code generation job
enum JobStatus: String, Codable, Hashable {
    case queued
    case planning
    case codegen
    case apply
    case test
    case pr_open
    case complete
    case failed
}

/// A code generation job
struct Job: Identifiable, Codable, Hashable {
    /// Unique identifier
    let id: String
    
    /// Current status of the job
    let status: JobStatus
    
    /// Repository the job is working with
    let repo: String
    
    /// Branch where changes are being made (optional)
    let branch: String?
    
    /// URL to the pull request (optional)
    let prUrl: String?
    
    /// Error message if job failed (optional)
    let error: String?
    
    /// Timestamp when the job was created
    let createdAt: Date
    
    /// Timestamp when the job was last updated
    let updatedAt: Date
    
    /// Initialize a new job
    init(id: String = UUID().uuidString,
         status: JobStatus,
         repo: String,
         branch: String? = nil,
         prUrl: String? = nil,
         error: String? = nil,
         createdAt: Date = Date(),
         updatedAt: Date = Date()) {
        self.id = id
        self.status = status
        self.repo = repo
        self.branch = branch
        self.prUrl = prUrl
        self.error = error
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
    
    /// Check if the job is in a terminal state (completed or failed)
    var isComplete: Bool {
        return status == .complete || status == .failed
    }
    
    /// Check if the job has a PR open
    var hasPullRequest: Bool {
        return prUrl != nil && status == .pr_open
    }
    
    /// Get a user-friendly status description
    var statusDescription: String {
        switch status {
        case .queued:
            return "Queued"
        case .planning:
            return "Planning changes"
        case .codegen:
            return "Generating code"
        case .apply:
            return "Applying changes"
        case .test:
            return "Testing changes"
        case .pr_open:
            return "Pull request open"
        case .complete:
            return "Completed"
        case .failed:
            return "Failed"
        }
    }
}
