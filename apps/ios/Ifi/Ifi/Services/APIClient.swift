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
    case retryLimitExceeded
    
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
        case .retryLimitExceeded:
            return "Retry limit exceeded"
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
    
    /// Default timeout interval for requests (90 seconds for AI streaming)
    private let timeoutInterval: TimeInterval = 90.0
    
    /// Publisher for streaming updates
    private var streamPublisher: PassthroughSubject<String, Error>?
    
    /// Current data task for streaming
    private var currentTask: URLSessionDataTask?
    
    /// Cancellable storage for stream subscriptions
    private var cancellables = Set<AnyCancellable>()
    
    /// Buffer for accumulating partial SSE data
    private var streamBuffer = ""
    
    /// Maximum number of retries for network requests
    private let maxRetries = 3
    
    /// Current retry count for the active request
    private var currentRetryCount = 0
    
    /// Retry delay in seconds (exponential backoff)
    private func retryDelay(for attempt: Int) -> TimeInterval {
        return pow(2.0, Double(attempt)) // 2, 4, 8, 16...
    }
    
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
        // Reset state for new request
        streamBuffer = ""
        currentRetryCount = 0
        
        // Create the request
        let endpoint = "/v1/chat/messages"
        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            handler.handleError(APIError.invalidURL)
            return
        }
        
        #if DEBUG
        print("[APIClient] Sending chat message to \(url.absoluteString)")
        print("[APIClient] Message: \(message)")
        print("[APIClient] ThreadId: \(threadId ?? "new thread")")
        #endif
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.timeoutInterval = timeoutInterval
        
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
                // Check if we should retry
                if self.shouldRetry(error: error) {
                    self.retryRequest(request: request, handler: handler)
                    return
                }
                
                self.streamPublisher?.send(completion: .failure(APIError.requestFailed(error)))
                return
            }
            
            guard let httpResponse = response as? HTTPURLResponse else {
                self.streamPublisher?.send(completion: .failure(APIError.invalidResponse))
                return
            }
            
            // Check for HTTP errors
            if httpResponse.statusCode >= 400 {
                // Check if we should retry server errors (5xx)
                if httpResponse.statusCode >= 500 && self.currentRetryCount < self.maxRetries {
                    self.retryRequest(request: request, handler: handler)
                    return
                }
                
                self.streamPublisher?.send(completion: .failure(
                    APIError.serverError(httpResponse.statusCode, "Server returned error status")
                ))
                return
            }
            
            // The actual streaming is handled by the URLSessionDataDelegate methods
            #if DEBUG
            print("[APIClient] HTTP response received: \(httpResponse.statusCode)")
            print("[APIClient] Content-Type: \(httpResponse.value(forHTTPHeaderField: "Content-Type") ?? "none")")
            #endif
        }
        
        // Store the task and start it
        self.currentTask = task
        task.resume()
        
        #if DEBUG
        print("[APIClient] Request started with timeout: \(timeoutInterval) seconds")
        #endif
    }
    
    /// Retry a failed request with exponential backoff
    private func retryRequest(request: URLRequest, handler: StreamHandler) {
        currentRetryCount += 1
        
        if currentRetryCount > maxRetries {
            streamPublisher?.send(completion: .failure(APIError.retryLimitExceeded))
            return
        }
        
        let delay = retryDelay(for: currentRetryCount)
        
        #if DEBUG
        print("[APIClient] Retrying request (attempt \(currentRetryCount)/\(maxRetries)) after \(delay) seconds")
        #endif
        
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self else { return }
            
            // Create and start a new data task
            let task = self.session.dataTask(with: request)
            self.currentTask = task
            task.resume()
        }
    }
    
    /// Determine if we should retry based on the error
    private func shouldRetry(error: Error) -> Bool {
        // Don't retry if we've hit the limit
        if currentRetryCount >= maxRetries {
            return false
        }
        
        // Check for network-related errors that might be temporary
        let nsError = error as NSError
        let shouldRetry = nsError.domain == NSURLErrorDomain &&
            (nsError.code == NSURLErrorTimedOut ||
             nsError.code == NSURLErrorNetworkConnectionLost ||
             nsError.code == NSURLErrorNotConnectedToInternet ||
             nsError.code == NSURLErrorCannotConnectToHost)
        
        return shouldRetry
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
        // Process the streaming data
        guard let text = String(data: data, encoding: .utf8) else {
            #if DEBUG
            print("[APIClient] ❌ Received non-UTF8 data: \(data.count) bytes")
            #endif
            streamPublisher?.send(completion: .failure(APIError.invalidResponse))
            return
        }
        
        #if DEBUG
        print("[APIClient] 📦 Received \(data.count) bytes of data")
        print("[APIClient] 📝 Raw data: \(text)")
        #endif
        
        // Append to buffer and process complete lines
        streamBuffer += text
        processStreamBuffer()
    }
    
    /// Process the stream buffer to extract complete SSE messages
    private func processStreamBuffer() {
        // Look for complete lines in the buffer
        while let newlineRange = streamBuffer.range(of: "\n") {
            // Extract a complete line
            let line = streamBuffer[..<newlineRange.lowerBound]
            streamBuffer = String(streamBuffer[newlineRange.upperBound...])
            
            // Process the line
            processStreamLine(String(line))
        }
    }
    
    /// Process a single line from the SSE stream
    private func processStreamLine(_ line: String) {
        let trimmedLine = line.trimmingCharacters(in: .whitespacesAndNewlines)
        
        #if DEBUG
        print("[APIClient] 🔍 Processing line: \(trimmedLine)")
        #endif
        
        // Skip empty lines
        if trimmedLine.isEmpty {
            return
        }
        
        // Check for completion marker
        if trimmedLine == "[DONE]" {
            #if DEBUG
            print("[APIClient] ✅ Stream complete: [DONE]")
            #endif
            streamPublisher?.send(completion: .finished)
            return
        }
        
        // Handle SSE format with "data: " prefix
        if trimmedLine.hasPrefix("data: ") {
            let dataContent = trimmedLine.dropFirst(6).trimmingCharacters(in: .whitespacesAndNewlines)
            
            // Check for completion marker in data content
            if dataContent == "[DONE]" {
                #if DEBUG
                print("[APIClient] ✅ Stream complete: data: [DONE]")
                #endif
                streamPublisher?.send(completion: .finished)
                return
            }
            
            // With toTextStreamResponse(), the content is plain text, no need for JSON parsing
            #if DEBUG
            print("[APIClient] 📤 Sending text from SSE: \(dataContent)")
            #endif
            streamPublisher?.send(dataContent)
        } else {
            // Direct text (non-SSE format) - just send it as is
            #if DEBUG
            print("[APIClient] 📤 Sending direct text: \(trimmedLine)")
            #endif
            streamPublisher?.send(trimmedLine)
        }
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            #if DEBUG
            print("[APIClient] ❌ Task completed with error: \(error.localizedDescription)")
            #endif
            
            // Check if we should retry
            if shouldRetry(error: error), let request = task.originalRequest {
                #if DEBUG
                print("[APIClient] 🔄 Will retry request")
                #endif
                
                // Create a dummy handler that forwards to the stream publisher
                let dummyHandler = DummyStreamHandler(publisher: streamPublisher)
                retryRequest(request: request, handler: dummyHandler)
                return
            }
            
            streamPublisher?.send(completion: .failure(APIError.requestFailed(error)))
        } else {
            #if DEBUG
            print("[APIClient] ✅ Task completed successfully")
            #endif
            
            // Process any remaining data in the buffer
            if !streamBuffer.isEmpty {
                #if DEBUG
                print("[APIClient] 🧹 Processing remaining buffer: \(streamBuffer)")
                #endif
                processStreamBuffer()
            }
            
            streamPublisher?.send(completion: .finished)
        }
    }
    
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        #if DEBUG
        print("[APIClient] 🔀 Following redirect to: \(request.url?.absoluteString ?? "unknown")")
        #endif
        completionHandler(request)
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

// MARK: - DummyStreamHandler

/// Handler that forwards to a stream publisher (used for retries)
private class DummyStreamHandler: StreamHandler {
    private weak var publisher: PassthroughSubject<String, Error>?
    
    init(publisher: PassthroughSubject<String, Error>?) {
        self.publisher = publisher
    }
    
    func handleChunk(_ text: String) {
        publisher?.send(text)
    }
    
    func handleCompletion() {
        publisher?.send(completion: .finished)
    }
    
    func handleError(_ error: Error) {
        publisher?.send(completion: .failure(error))
    }
}
