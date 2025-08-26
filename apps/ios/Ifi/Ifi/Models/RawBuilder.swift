//
//  RawBuilder.swift
//  Ifi
//
//  Created on 8/26/25.
//

import Foundation

/// Builds structured content by parsing raw text containing markdown
struct RawBuilder {
    /// Raw text buffer containing markdown content to parse
    var buffer: String = ""
    
    /// Container for parsed content items with end-of-message detection
    struct Content {
        /// Array of parsed content items
        var items: [StreamContentItem<ContinuousItem>] = []
        /// Whether end-of-message marker was detected
        var eom: Bool = false
        
        /// Appends markdown content as a continuous item
        /// - Parameters:
        ///   - markdown: The markdown text to append
        ///   - finished: Whether this is the final part of the content
        ///   - ids: Generator for creating unique identifiers
        mutating func append(markdown: some StringProtocol, finished: Bool, ids: inout IdentifierGenerator) {
            let continuousItem = ContinuousItem(
                finished: finished || eom,
                value: .markdown(String(markdown))
            )
            let item = StreamContentItem<ContinuousItem>(ids: &ids, value: continuousItem)
            items.append(item)
        }
        
        /// Appends an error as a continuous item
        /// - Parameters:
        ///   - error: The error to append
        ///   - finished: Whether this is the final part of the content
        ///   - ids: Generator for creating unique identifiers
        mutating func append(error: Error, finished: Bool, ids: inout IdentifierGenerator) {
            let continuousItem = ContinuousItem(
                finished: finished || eom,
                value: .error(IdentifiableError(ids: &ids, underlyingError: error))
            )
            let item = StreamContentItem<ContinuousItem>(ids: &ids, value: continuousItem)
            items.append(item)
        }
    }
    
    /// Represents a continuous item with completion state
    struct ContinuousItem: Equatable {
        /// Whether this item represents complete content
        var finished: Bool
        /// The actual content value
        var value: Item
    }
    
    /// Represents different types of content items that can be parsed
    enum Item: Equatable {
        /// Raw markdown text content
        case markdown(String)
        /// Error encountered during parsing
        case error(IdentifiableError)
    }
    
    /// Builds structured content by parsing the buffer into markdown segments
    /// - Returns: A Content object containing the parsed items and end-of-message state
    func build() -> Content {
        var ids: any IdentifierGenerator = IncrementalIdentifierGenerator.create()
        var content = Content()
        var buffer = self.buffer
        
        // Check for end-of-message marker
        let eomIndex = buffer.firstRange(of: "<eom>")?.lowerBound
        if let eomIndex {
            let remainingCount = buffer.distance(from: eomIndex, to: buffer.endIndex)
            buffer.removeLast(remainingCount)
            content.eom = true
        }
        
        // Check for code block markers
        let codeBlockPattern = "```([a-zA-Z0-9]*)\n([\\s\\S]*?)```"
        
        do {
            // Process the buffer as markdown
            if !buffer.isEmpty {
                content.append(markdown: buffer, finished: content.eom, ids: &ids)
            }
        } catch {
            // Handle any parsing errors
            content.append(error: error, finished: !buffer.isEmpty, ids: &ids)
        }
        
        return content
    }
    
    /// Checks if markdown content is valid and complete
    /// - Parameter content: The markdown content to validate
    /// - Returns: True if the content is valid and complete
    func isValidMarkdown(_ content: String) -> Bool {
        // Basic validation - check for balanced markers
        let codeBlocks = content.components(separatedBy: "```").count - 1
        if codeBlocks % 2 != 0 && codeBlocks > 0 {
            return false
        }
        
        // Check for unclosed parentheses in links
        let openParenCount = content.filter { $0 == "(" }.count
        let closeParenCount = content.filter { $0 == ")" }.count
        if openParenCount != closeParenCount {
            return false
        }
        
        return true
    }
    
    /// Attempts to fix common markdown issues
    /// - Parameter content: The markdown content to fix
    /// - Returns: Fixed markdown content
    func fixMarkdown(_ content: String) -> String {
        var fixedContent = content
        
        // Fix unclosed code blocks
        let codeBlocks = fixedContent.components(separatedBy: "```").count - 1
        if codeBlocks % 2 != 0 && codeBlocks > 0 {
            fixedContent += "\n```"
        }
        
        return fixedContent
    }
}
