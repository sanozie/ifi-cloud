//
//  StreamContent.swift
//  Ifi
//
//  Created on 8/26/25.
//

import Foundation
import SwiftUI

/// Represents a stream of content items with state information
struct StreamContent: Equatable, Sendable {
    /// Array of content items in the stream
    var items: [Item] = []
    
    /// Whether the stream has finished receiving content
    var finished: Bool = false
    
    /// Collection of errors encountered during stream processing
    var errors: [IdentifiableError] = []
    
    /// Stream configuration options
    var options: [String: String] = [:]
    
    typealias Item = StreamContentItem<StreamItemValue>
    
    /// Replaces the value of the last item in the stream with a new value
    /// - Parameter newValue: The new value to set for the last item
    mutating func replaceLastValue(_ newValue: StreamItemValue) {
        guard !items.isEmpty else { return }
        items[items.count - 1].value = newValue
    }
    
    /// Appends a new markdown entry to the content items
    /// - Parameters:
    ///   - entry: The markdown entry to append
    ///   - ids: Generator for creating unique identifiers
    mutating func appendMarkdown(_ entry: MarkdownEntry, ids: inout IdentifierGenerator) {
        let item = StreamContentItem<StreamItemValue>(ids: &ids, value: .markdown(entry))
        items.append(item)
    }
    
    /// Appends a new markdown table to the content items
    /// - Parameters:
    ///   - table: The markdown table to append
    ///   - ids: Generator for creating unique identifiers
    mutating func appendMarkdownTable(_ table: MarkdownTable, ids: inout IdentifierGenerator) {
        let item = StreamContentItem<StreamItemValue>(ids: &ids, value: .markdownTable(table))
        items.append(item)
    }
    
    /// Appends an error to the errors collection
    /// - Parameters:
    ///   - error: The error to append
    ///   - ids: Generator for creating unique identifiers
    mutating func appendError(_ error: Error, ids: inout IdentifierGenerator) {
        let identifiableError = IdentifiableError(ids: &ids, underlyingError: error)
        errors.append(identifiableError)
    }
}

/// A uniquely identifiable content item in the stream
struct StreamContentItem<Value: Equatable>: Identifiable, Equatable {
    /// Unique identifier for the content item
    var id: IdentifierGenerator.ID
    
    /// The value contained by this item
    var value: Value
    
    /// Creates a new content item with a unique identifier
    /// - Parameters:
    ///   - ids: Generator for creating unique identifiers
    ///   - value: The value to store in this item
    init(ids: inout IdentifierGenerator, value: Value) {
        self.id = ids()
        self.value = value
    }
}

extension StreamContentItem: Sendable where Value: Sendable {}

/// Represents the different types of content that can appear in a stream
enum StreamItemValue: Equatable, Sendable {
    /// Markdown formatted text content
    case markdown(MarkdownEntry)
    
    /// Tabular data formatted in markdown
    case markdownTable(MarkdownTable)
    
    /// Code block with syntax highlighting
    case codeBlock(CodeBlock)
    
    /// Raw XML elements (for future extensibility)
    case xml(String)
}

/// Represents a block of markdown content
struct MarkdownEntry: Equatable, Sendable {
    /// The raw markdown text
    var content: String
    
    /// Whether this entry is collapsible
    var isCollapsible: Bool = false
    
    /// Whether the entry is currently expanded (if collapsible)
    var isExpanded: Bool = true
    
    /// Creates a new markdown entry
    /// - Parameters:
    ///   - content: The markdown content
    ///   - isCollapsible: Whether this entry can be collapsed
    ///   - isExpanded: Whether the entry is expanded by default
    init(content: String, isCollapsible: Bool = false, isExpanded: Bool = true) {
        self.content = content
        self.isCollapsible = isCollapsible
        self.isExpanded = isExpanded
    }
}

/// Represents a markdown table
struct MarkdownTable: Equatable, Sendable {
    /// The raw markdown table content
    var content: String
    
    /// Optional title for the table
    var title: String?
    
    /// Optional caption for the table
    var caption: String?
    
    /// Creates a new markdown table
    /// - Parameters:
    ///   - content: The markdown table content
    ///   - title: Optional title for the table
    ///   - caption: Optional caption for the table
    init(content: String, title: String? = nil, caption: String? = nil) {
        self.content = content
        self.title = title
        self.caption = caption
    }
}

/// Represents a code block with syntax highlighting
struct CodeBlock: Equatable, Sendable {
    /// The code content
    var code: String
    
    /// The programming language for syntax highlighting
    var language: String?
    
    /// Optional title or description
    var title: String?
    
    /// Creates a new code block
    /// - Parameters:
    ///   - code: The code content
    ///   - language: The programming language for syntax highlighting
    ///   - title: Optional title or description
    init(code: String, language: String? = nil, title: String? = nil) {
        self.code = code
        self.language = language
        self.title = title
    }
}
