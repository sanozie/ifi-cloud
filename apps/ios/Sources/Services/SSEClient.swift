import Foundation

/// Client for Server-Sent Events (SSE)
class SSEClient {
    /// Current task for streaming
    private var task: URLSessionDataTask?
    
    /// Flag indicating if client is connected
    private(set) var isConnected = false
    
    /// Event callback
    private var eventCallback: ((String) -> Void)?
    
    /// URL session for requests
    private let session: URLSession
    
    /// Initialize with custom session configuration
    init(sessionConfiguration: URLSessionConfiguration = .default) {
        let config = sessionConfiguration
        config.timeoutIntervalForRequest = 300 // 5 minute timeout
        config.httpMaximumConnectionsPerHost = 1
        
        self.session = URLSession(configuration: config)
    }
    
    /// Start listening for SSE events
    /// - Parameters:
    ///   - url: URL to connect to
    ///   - onEvent: Callback for received events
    func start(url: URL, onEvent: @escaping (String) -> Void) {
        // Stop any existing connection
        stop()
        
        // Store callback
        self.eventCallback = onEvent
        
        // Create request
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        
        // Create data task
        task = session.dataTask(with: request) { [weak self] data, response, error in
            guard let self = self else { return }
            
            // Handle connection error
            if let error = error {
                print("SSE connection error: \(error.localizedDescription)")
                self.isConnected = false
                
                // TODO: Implement reconnection logic
                return
            }
            
            // Check response
            guard let httpResponse = response as? HTTPURLResponse else {
                print("SSE invalid response")
                self.isConnected = false
                return
            }
            
            // Check status code
            guard (200...299).contains(httpResponse.statusCode) else {
                print("SSE HTTP error: \(httpResponse.statusCode)")
                self.isConnected = false
                return
            }
            
            // Process data if available
            if let data = data, !data.isEmpty {
                self.isConnected = true
                
                // Parse SSE data
                if let text = String(data: data, encoding: .utf8) {
                    self.processEventData(text)
                }
            }
        }
        
        // Start the task
        task?.resume()
        
        // MARK: - Note on implementation
        // This is a stub implementation that doesn't properly handle streaming.
        // A real implementation would use URLSession.streamTask or implement
        // proper event parsing with buffer management for incomplete events.
        //
        // For a complete implementation:
        // 1. Use URLSession.streamTask for true streaming
        // 2. Implement proper SSE protocol parsing (data: lines, id:, event:, etc.)
        // 3. Add reconnection with exponential backoff
        // 4. Support Last-Event-ID header for resuming
    }
    
    /// Stop listening for SSE events
    func stop() {
        task?.cancel()
        task = nil
        isConnected = false
        eventCallback = nil
    }
    
    /// Process SSE event data
    /// - Parameter text: Raw event text
    private func processEventData(_ text: String) {
        // Split text into lines
        let lines = text.components(separatedBy: "\n")
        
        // Process each line
        var eventData = ""
        
        for line in lines {
            // Skip empty lines
            if line.isEmpty {
                continue
            }
            
            // Check for data prefix
            if line.hasPrefix("data:") {
                // Extract data content (remove "data: " prefix)
                let dataContent = line.dropFirst(5).trimmingCharacters(in: .whitespacesAndNewlines)
                eventData = dataContent
                
                // Call event callback with data
                DispatchQueue.main.async {
                    self.eventCallback?(eventData)
                }
            }
            
            // Note: A full implementation would handle other SSE fields like "id:" and "event:"
        }
    }
    
    /// Fallback polling implementation for environments where SSE is not supported
    /// - Parameters:
    ///   - url: URL to poll
    ///   - interval: Polling interval in seconds
    ///   - onEvent: Callback for received events
    func startPolling(url: URL, interval: TimeInterval = 3.0, onEvent: @escaping (String) -> Void) {
        // This is a stub method for polling-based implementation
        // It would periodically fetch from the URL and simulate SSE behavior
        // Not implemented in this MVP version
        
        print("Polling fallback not implemented in MVP")
        
        // For reference, implementation would use Timer to periodically call:
        // URLSession.shared.dataTask(with: url) { data, response, error in ... }
    }
}
