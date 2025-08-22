import Foundation

/// API client for communicating with the backend
class APIClient {
    /// Base URL for API requests
    private let baseURL: URL
    
    /// URL session for making requests
    private let session: URLSession
    
    /// Initialize with base URL
    init(baseURL: URL) {
        self.baseURL = baseURL
        
        // Create URL session with default configuration
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30.0
        self.session = URLSession(configuration: config)
    }
    
    /// Send a chat message to the API
    /// - Parameters:
    ///   - threadId: Optional thread ID for existing conversation
    ///   - message: Message content
    /// - Returns: A tuple containing optional job ID and reply
    func sendChat(threadId: String?, message: String) async throws -> (jobId: String?, reply: String?) {
        // Construct request URL
        let url = baseURL.appendingPathComponent("/api/chat")
        
        // Create request
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        
        // Create request body
        let body: [String: Any] = [
            "threadId": threadId as Any,
            "message": message,
            "context": [String: String]()
        ]
        
        // Serialize request body to JSON
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        // Send request
        let (data, response) = try await session.data(for: request)
        
        // Check response status code
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        // Handle error responses
        guard 200..<300 ~= httpResponse.statusCode else {
            if let errorJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let errorMessage = errorJson["message"] as? String {
                throw APIError.serverError(message: errorMessage, statusCode: httpResponse.statusCode)
            } else {
                throw APIError.serverError(message: "Unknown error", statusCode: httpResponse.statusCode)
            }
        }
        
        // Parse response
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw APIError.invalidData
        }
        
        // Extract job ID and reply
        let jobId = json["jobId"] as? String
        let reply = json["reply"] as? String
        
        return (jobId: jobId, reply: reply)
    }
    
    /// Get job status from the API
    /// - Parameter id: Job ID
    /// - Returns: Job object if found
    func getJob(id: String) async throws -> Job {
        // Construct request URL
        let url = baseURL.appendingPathComponent("/api/jobs/\(id)")
        
        // Create request
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        
        // Send request
        let (data, response) = try await session.data(for: request)
        
        // Check response status code
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        
        // Handle error responses
        guard 200..<300 ~= httpResponse.statusCode else {
            if httpResponse.statusCode == 404 {
                throw APIError.resourceNotFound
            } else if let errorJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let errorMessage = errorJson["message"] as? String {
                throw APIError.serverError(message: errorMessage, statusCode: httpResponse.statusCode)
            } else {
                throw APIError.serverError(message: "Unknown error", statusCode: httpResponse.statusCode)
            }
        }
        
        // Parse response
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw APIError.invalidData
        }
        
        // Extract job properties
        guard let id = json["id"] as? String,
              let statusString = json["status"] as? String,
              let repo = json["repo"] as? String,
              let createdAtString = json["createdAt"] as? String,
              let updatedAtString = json["updatedAt"] as? String else {
            throw APIError.invalidData
        }
        
        // Parse dates
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        
        guard let createdAt = dateFormatter.date(from: createdAtString),
              let updatedAt = dateFormatter.date(from: updatedAtString) else {
            throw APIError.invalidData
        }
        
        // Parse status
        guard let status = JobStatus(rawValue: statusString) else {
            throw APIError.invalidData
        }
        
        // Create and return job
        return Job(
            id: id,
            status: status,
            repo: repo,
            branch: json["branch"] as? String,
            prUrl: json["prUrl"] as? String,
            error: json["error"] as? String,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

/// API error types
enum APIError: Error {
    case invalidURL
    case invalidResponse
    case invalidData
    case resourceNotFound
    case serverError(message: String, statusCode: Int)
    
    var localizedDescription: String {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .invalidData:
            return "Invalid data received from server"
        case .resourceNotFound:
            return "Resource not found"
        case .serverError(let message, let statusCode):
            return "Server error (\(statusCode)): \(message)"
        }
    }
}
