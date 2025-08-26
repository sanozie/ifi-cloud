//
//  APIClient.swift
//  Ifi
//
//  Created on 8/25/25.
//

import Foundation
import Combine

/// Error types that can be thrown by the APIClient
enum APIError: Error {
    case invalidURL
    case requestFailed(Error)
    case invalidResponse
    case decodingFailed(Error)
    case serverError(Int, String)
    case networkError
    case streamError(String)
    case timeout
    
    var localizedDescription: String {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .requestFailed(let error):
            return "Request failed: \(error.localizedDescription)"
        case .invalidResponse:
            return "Invalid response from server"
        case .decodingFailed(let error):
            return "Failed to decode response: \(error.localizedDescription)"
        case .serverError(let code, let message):
            return "Server error \(code): \(message)"
        case .networkError:
            return "Network connection error"
        case .streamError(let message):
            return "Stream error: \(message)"
        case .timeout:
            return "Request timed out"
        }
    }
}

/// Response structure for chat messages
struct ChatResponse: Decodable {
    let threadId: String
    let messages: [MessageResponse]
}

/// Individual message structure
struct MessageResponse: Decodable, Identifiable {
    let id: String
    let role: String
    let content: String
    let createdAt: Date
}

/// Thread summary returned by GET /v1/threads
struct ThreadResponse: Decodable, Identifiable {
    let id: String
    let title: String
    let createdAt: Date
    let updatedAt: Date
    let lastMessage: MessageResponse?
}

/// Full thread with all messages returned by GET /v1/threads/:id
struct ThreadWithMessages: Decodable, Identifiable {
    let id: String
    let title: String
    let createdAt: Date
    let updatedAt: Date
    let messages: [MessageResponse]
}

/// Chat request structure
struct ChatRequest: Encodable {
    let threadId: String?
    let input: String
}

/// Job status response
struct JobResponse: Decodable {
    let id: String
    let status: String
    let progress: Double?
    let error: String?
    let pr: PullRequestInfo?
}

/// Pull request information
struct PullRequestInfo: Decodable {
    let url: String
    let number: Int
    let status: String
}

/// Represents a chunk of streamed data from the AI response
struct StreamChunk: Decodable {
    let id: String?
    let object: String?
    let created: Int?
    let model: String?
    let choices: [Choice]?
    
    struct Choice: Decodable {
        let index: Int?
        let delta: Delta?
        let finishReason: String?
        
        enum CodingKeys: String, CodingKey {
            case index
            case delta
            case finishReason = "finish_reason"
        }
    }
    
    struct Delta: Decodable {
        let content: String?
        let role: String?
    }
}

/// Protocol for handling streamed message chunks
protocol StreamHandler {
    func handleChunk(_ text: String)
    func handleCompletion()
    func handleError(_ error: Error)
}

/// Main API client for interacting with the backend
class APIClient: NSObject {
    // MARK: - Properties
    
    /// Base URL for the API
    private let baseURL: URL
    
    /// URLSession for network requests – constructed lazily so `self` is
    /// available as the delegate. Using a delegate ensures incremental
    /// streaming callbacks are delivered to `urlSession(_:dataTask:didReceive:)`.
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = timeoutInterval
        configuration.timeoutIntervalForResource = timeoutInterval * 2
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()
    
    /// Default timeout interval for requests
    private let timeoutInterval: TimeInterval = 30.0
    
    /// Publisher for streaming updates
    private var streamPublisher: PassthroughSubject<String, Error>?
    
    /// Current data task for streaming
    private var currentTask: URLSessionDataTask?
    
    /// Cancellable storage for stream subscriptions
    private var cancellables = Set<AnyCancellable>()
    
    // MARK: - Date Formatters (ISO-8601 Helper)
    /// A small set of reusable `ISO8601DateFormatter`s that accept
    /// second-precision and millisecond-precision timestamps.  
    /// These are consulted (in order) by our custom `dateDecodingStrategy`
    /// to ensure the client can tolerate either format returned by the API.
    ///
    ///  • `yyyy-MM-dd'T'HH:mm:ssZ`  
    ///  • `yyyy-MM-dd'T'HH:mm:ss.SSSZ`
    ///
    /// Additional sub-millisecond precision is also handled because the
    /// formatter with `.withFractionalSeconds` will parse any fractional
    /// length up to 6 digits.
    static let iso8601Formatters: [ISO8601DateFormatter] = {
        // Base options common to both variants
        let base: ISO8601DateFormatter.Options = [
            .withInternetDateTime,
            .withDashSeparatorInDate,
            .withColonSeparatorInTimeZone
        ]
        
        func make(_ extra: ISO8601DateFormatter.Options = []) -> ISO8601DateFormatter {
            let f = ISO8601DateFormatter()
            f.formatOptions = base.union(extra)
            f.timeZone = .init(secondsFromGMT: 0)   // always UTC
            return f
        }
        
        return [
            make(),                               // no fractional seconds
            make(.withFractionalSeconds)          // milliseconds / microseconds
        ]
    }()
    
    // MARK: - Initialization
    
    /// Initialize with a custom base URL
    /// - Parameter baseURLString: The base URL string for the API
    init(baseURLString: String = "http://localhost:3000") {
        guard let url = URL(string: baseURLString) else {
            fatalError("Invalid base URL: \(baseURLString)")
        }
        self.baseURL = url
        
    }
    
    // MARK: - API Methods
    
    /// Send a chat message and receive a streamed response
    /// - Parameters:
    ///   - message: The message text to send
    ///   - threadId: Optional thread ID for continuing a conversation
    ///   - handler: Handler for processing streamed responses
    func sendChatMessage(
        message: String,
        threadId: String? = nil,
        handler: StreamHandler
    ) {
        // Create the request
        let endpoint = "/v1/chat/messages"
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            handler.handleError(APIError.invalidURL)
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("text/event-stream", forHTTPHeaderField: "Accept")
        
        // Prepare the request body
        let chatRequest = ChatRequest(threadId: threadId, input: message)
        do {
            request.httpBody = try JSONEncoder().encode(chatRequest)
        } catch {
            handler.handleError(APIError.requestFailed(error))
            return
        }
        
        // Create a publisher for streaming updates
        let publisher = PassthroughSubject<String, Error>()
        self.streamPublisher = publisher
        
        // Subscribe to the publisher
        publisher
            .sink(
                receiveCompletion: { completion in
                    switch completion {
                    case .finished:
                        handler.handleCompletion()
                    case .failure(let error):
                        handler.handleError(error)
                    }
                },
                receiveValue: { chunk in
                    handler.handleChunk(chunk)
                }
            )
            .store(in: &cancellables)
        
        // Create and start the data task
        let task = session.dataTask(with: request) { [weak self] _, response, error in
            guard let self = self else { return }
            
            if let error = error {
                self.streamPublisher?.send(completion: .failure(APIError.requestFailed(error)))
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse else {
                self.streamPublisher?.send(completion: .failure(APIError.invalidResponse))
                return
            }
            
            // Check for HTTP errors
            if httpResponse.statusCode >= 400 {
                self.streamPublisher?.send(completion: .failure(
                    APIError.serverError(httpResponse.statusCode, "Server returned error status")
                ))
                return
            }
            
            // The actual streaming is handled by the URLSessionDataDelegate methods
        }
        
        // Store the task and start it
        self.currentTask = task
        task.resume()
    }
    
    /// Send a chat message and receive a streamed response using async/await
    /// - Parameters:
    ///   - message: The message text to send
    ///   - threadId: Optional thread ID for continuing a conversation
    /// - Returns: An async stream of message chunks
    func sendChatMessageAsync(
        message: String,
        threadId: String? = nil
    ) -> AsyncThrowingStream<String, Error> {
        return AsyncThrowingStream { continuation in
            let handler = AsyncStreamHandler(continuation: continuation)
            self.sendChatMessage(message: message, threadId: threadId, handler: handler)
        }
    }
    
    /// Get the status of a job
    /// - Parameter jobId: The ID of the job to check
    /// - Returns: The job status response
    func getJobStatus(jobId: String) async throws -> JobResponse {
        let endpoint = "/v1/jobs/\(jobId)"
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        
        do {
            let (data, response) = try await session.data(for: request)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }
            
            if httpResponse.statusCode >= 400 {
                throw APIError.serverError(httpResponse.statusCode, "Server returned error status")
            }
            
            let decoder = JSONDecoder()
            decoder.keyDecodingStrategy = .convertFromSnakeCase
            decoder.dateDecodingStrategy = .iso8601
            
            return try decoder.decode(JobResponse.self, from: data)
        } catch let decodingError as DecodingError {
            throw APIError.decodingFailed(decodingError)
        } catch {
            throw APIError.requestFailed(error)
        }
    }
    
    /// Cancel any ongoing streaming request
    func cancelCurrentRequest() {
        currentTask?.cancel()
        currentTask = nil
        streamPublisher?.send(completion: .finished)
        streamPublisher = nil
    }

    // MARK: - Thread APIs

    /// Fetch all threads (summary)
    func fetchThreads() async throws -> [ThreadResponse] {
        let endpoint = "/v1/threads"
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }

            if httpResponse.statusCode >= 400 {
                throw APIError.serverError(httpResponse.statusCode, "Server returned error status")
            }

            let decoder = JSONDecoder()
            // Accept both second-precision and millisecond-precision ISO-8601 dates
            decoder.dateDecodingStrategy = .custom { decoder in
                let container = try decoder.singleValueContainer()
                let raw = try container.decode(String.self)
                for fmt in APIClient.iso8601Formatters {
                    if let date = fmt.date(from: raw) {
                        return date
                    }
                }
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Expected ISO8601 date string, got \(raw)"
                )
            }
            
            // ---------------------------------------------------------
            // Debug aid: Log raw response to diagnose decoding issues
            // ---------------------------------------------------------
            #if DEBUG
            if let raw = String(data: data, encoding: .utf8) {
                print("[APIClient] fetchThreads raw response: \(raw)")
            } else {
                print("[APIClient] fetchThreads raw response (non-UTF8, \(data.count) bytes)")
            }
            #endif

            return try decoder.decode([ThreadResponse].self, from: data)
        } catch let decodingError as DecodingError {
            throw APIError.decodingFailed(decodingError)
        } catch {
            throw APIError.requestFailed(error)
        }
    }

    /// Fetch a single thread with all messages
    func fetchThread(id: String) async throws -> ThreadWithMessages {
        // ---------------------------------------------------------
        // Debug: log entry into method
        // ---------------------------------------------------------
        #if DEBUG
        print("[APIClient] fetchThread called with id: \(id)")
        #endif

        let endpoint = "/v1/thread/\(id)"
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }

        #if DEBUG
        print("[APIClient] fetchThread requesting URL: \(url.absoluteString)")
        #endif

        var request = URLRequest(url: url)
        request.httpMethod = "GET"

        do {
            let (data, response) = try await session.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.invalidResponse
            }

            if httpResponse.statusCode >= 400 {
                throw APIError.serverError(httpResponse.statusCode, "Server returned error status")
            }

            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .custom { decoder in
                let container = try decoder.singleValueContainer()
                let raw = try container.decode(String.self)
                for fmt in APIClient.iso8601Formatters {
                    if let date = fmt.date(from: raw) {
                        return date
                    }
                }
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Expected ISO8601 date string, got \(raw)"
                )
            }
            return try decoder.decode(ThreadWithMessages.self, from: data)
        } catch let decodingError as DecodingError {
            #if DEBUG
            print("[APIClient] fetchThread DecodingError: \(decodingError)")
            #endif
            throw APIError.decodingFailed(decodingError)
        } catch {
            #if DEBUG
            print("[APIClient] fetchThread requestFailed error: \(error.localizedDescription)")
            #endif
            throw APIError.requestFailed(error)
        }
    }

    /// Delete a thread
    func deleteThread(id: String) async throws {
        let endpoint = "/v1/thread/\(id)"
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"

        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode >= 400 {
            throw APIError.serverError(httpResponse.statusCode, "Server returned error status")
        }
    }
}

// MARK: - URLSessionDataDelegate Extension

extension APIClient: URLSessionDataDelegate {
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        // Process SSE data
        guard let text = String(data: data, encoding: .utf8) else {
            streamPublisher?.send(completion: .failure(APIError.invalidResponse))
            return
        }
        
        // Split the response by "data:" prefix (SSE format)
        let lines = text.components(separatedBy: "data: ")
        
        for line in lines {
            let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedLine.isEmpty && trimmedLine != "[DONE]" {
                // Parse the JSON chunk
                if let data = trimmedLine.data(using: .utf8) {
                    do {
                        let chunk = try JSONDecoder().decode(StreamChunk.self, from: data)
                        if let content = chunk.choices?.first?.delta?.content {
                            streamPublisher?.send(content)
                        }
                    } catch {
                        // If we can't decode as StreamChunk, just send the raw text
                        // This handles different formats that might come from Vercel AI SDK
                        streamPublisher?.send(trimmedLine)
                    }
                }
            } else if trimmedLine == "[DONE]" {
                streamPublisher?.send(completion: .finished)
            }
        }
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            streamPublisher?.send(completion: .failure(APIError.requestFailed(error)))
        } else {
            streamPublisher?.send(completion: .finished)
        }
    }
}

// MARK: - AsyncStreamHandler

/// Handler that bridges between the callback-based API and AsyncStream
private class AsyncStreamHandler: StreamHandler {
    private let continuation: AsyncThrowingStream<String, Error>.Continuation
    
    init(continuation: AsyncThrowingStream<String, Error>.Continuation) {
        self.continuation = continuation
    }
    
    func handleChunk(_ text: String) {
        continuation.yield(text)
    }
    
    func handleCompletion() {
        continuation.finish()
    }
    
    func handleError(_ error: Error) {
        continuation.finish(throwing: error)
    }
}
