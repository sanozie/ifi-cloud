//
//  StreamController.swift
//  Ifi
//
//  Created on 8/26/25.
//

import Foundation
import Combine

/// Controller responsible for processing streaming content and publishing parsed results
/// 
/// Handles buffering of incoming content chunks, parsing them into structured `StreamContent`,
/// and publishing the results while managing error notifications.
final class StreamController {
    /// Publisher that emits parsed `StreamContent` from the input stream
    ///
    /// The output is throttled and processed asynchronously to optimize performance.
    /// Any parsing errors are collected and logged through the error notification system.
    lazy var output: some Publisher<StreamContent, Never> = {
        $input
            .throttle(for: .milliseconds(8), scheduler: DispatchQueue.main, latest: true)
            .receive(on: DispatchQueue.global())
            .map { buffer in
                #if DEBUG
                print("[STREAM-DEBUG] 🔨 StreamController.map – building content from buffer len=\(buffer.count)")
                #endif
                let content = StreamContentBuilder(buffer: buffer).build()
                return content
            }
            .receive(on: DispatchQueue.main)
            .handleEvents(receiveOutput: { (content: StreamContent) in
                for error in content.errors {
                    self.notifyError(error)
                }
            })
            .share()
    }()
    
    /// Set of errors that have already been notified to avoid duplicates
    private var notifiedErrors: Set<IdentifiableError.ID> = []
    
    /// The raw input buffer that accumulates content chunks
    @Published private var input: String = ""
    
    /// Processes a new chunk of content by appending it to the input buffer
    /// - Parameter chunk: The new content chunk to process
    func processChunk(_ chunk: String) {
        #if DEBUG
        print("[STREAM-DEBUG] 📥 StreamController.processChunk – received chunk len=\(chunk.count), buffer total=\(input.count + chunk.count)")
        #endif
        input += chunk
    }
    
    /// Reset the input buffer and clear any error state
    func reset() {
        #if DEBUG
        print("[STREAM-DEBUG] 🔄 StreamController.reset – clearing buffer and error state")
        #endif
        input = ""
        notifiedErrors.removeAll()
    }
    
    /// Notifies about a new error if it hasn't been reported before
    /// - Parameter error: The error to notify about
    private func notifyError(_ error: IdentifiableError) {
        // Only notify about each unique error once
        guard !notifiedErrors.contains(error.id) else { return }
        
        // Add to the set of notified errors
        notifiedErrors.insert(error.id)
        
        // Log the error (in a real app, this might use a proper logging system)
        print("Stream parsing error: \(String(reflecting: error.underlyingError))")
    }
    
    /// Returns a publisher that emits when errors occur
    /// - Returns: A publisher of error notifications
    func errorPublisher() -> AnyPublisher<IdentifiableError, Never> {
        output
            .flatMap { content in
                Publishers.Sequence(sequence: content.errors)
            }
            .filter { error in
                !self.notifiedErrors.contains(error.id)
            }
            .handleEvents(receiveOutput: { error in
                self.notifiedErrors.insert(error.id)
            })
            .eraseToAnyPublisher()
    }
    
    /// Manually adds an error to the stream
    /// - Parameter error: The error to add
    func addError(_ error: Error) {
        #if DEBUG
        print("[STREAM-DEBUG] ❌ StreamController.addError – adding error: \(error.localizedDescription)")
        #endif
        var ids: any IdentifierGenerator = IncrementalIdentifierGenerator.create()
        let identifiableError = IdentifiableError(ids: &ids, underlyingError: error)
        notifyError(identifiableError)
    }
}
