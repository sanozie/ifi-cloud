//
//  StreamContentBuilder.swift
//  Ifi
//
//  Created on 8/26/25.
//

import Foundation

/// Builds structured stream content by processing raw content and applying various content builders
struct StreamContentBuilder {
    /// Raw text buffer containing content to be processed
    var buffer: String = ""
    
    /// Initialize with raw content buffer
    /// - Parameter buffer: The raw content to process
    init(buffer: String = "") {
        self.buffer = buffer
    }
    
    /// Processes raw content into structured stream content with unique identifiers
    /// - Parameters:
    ///   - raw: The raw content to process
    ///   - ids: Generator for creating unique identifiers
    /// - Returns: Processed stream content with markdown, tables, code blocks and errors
    func buildContent(raw: RawBuilder.Content, ids nestedIds: IdentifierGenerator) -> StreamContent {
        let ids = nestedIds
        var content = StreamContent()
        content.finished = raw.eom
        
        for rawItem in raw.items {
            switch rawItem.value.value {
            case .markdown(let markdown):
                var builder = MarkdownBuilder(rawMarkdown: markdown)
                if content.finished {
                    builder.cleanup()
                }
                
                // Process the markdown content
                let markdownContent = builder.build(ids: ids.nested())
                
                // Add all items from the markdown content
                for item in markdownContent.items {
                    content.items.append(item)
                }
                
            case .error(let error):
                if rawItem.value.finished {
                    content.errors.append(error)
                }
            }
        }
        
        return content
    }
    
    /// Builds the final stream content by processing raw content through multiple specialized builders
    /// - Returns: Fully processed stream content with all content types handled
    func build() -> StreamContent {
        // First, parse the raw buffer using RawBuilder
        let raw = RawBuilder(buffer: buffer).build()
        
        // Create an identifier generator for unique IDs
        let ids: any IdentifierGenerator = IncrementalIdentifierGenerator.create()
        
        // Process the raw content through the content building pipeline
        var content = buildContent(raw: raw, ids: ids.nested())
        
        // Apply post-processing to ensure content consistency
        content = postProcessContent(content, ids: ids.nested())
        
        return content
    }
    
    /// Performs post-processing on the content to ensure consistency and handle edge cases
    /// - Parameters:
    ///   - content: The content to post-process
    ///   - ids: Generator for creating unique identifiers
    /// - Returns: The post-processed content
    private func postProcessContent(_ content: StreamContent, ids: IdentifierGenerator) -> StreamContent {
        var processedContent = content
        var idsGenerator = ids
        
        // Handle empty content
        if processedContent.items.isEmpty && !buffer.isEmpty {
            // If we have buffer but no items, create a fallback markdown entry
            let entry = MarkdownEntry(content: buffer)
            processedContent.appendMarkdown(entry, ids: &idsGenerator)
        }
        
        // Handle unclosed code blocks at the end of the stream
        if processedContent.finished {
            fixUnclosedElements(&processedContent, ids: &idsGenerator)
        }
        
        return processedContent
    }
    
    /// Fixes unclosed elements like code blocks in the content
    /// - Parameters:
    ///   - content: The content to fix
    ///   - ids: Generator for creating unique identifiers
    private func fixUnclosedElements(_ content: inout StreamContent, ids: inout IdentifierGenerator) {
        // Check for unclosed code blocks
        let codeBlocks = buffer.components(separatedBy: "```").count - 1
        if codeBlocks % 2 != 0 && codeBlocks > 0 {
            // Add a closing code block marker
            let fixedBuffer = buffer + "\n```"
            
            // Re-parse with the fixed buffer
            let raw = RawBuilder(buffer: fixedBuffer).build()
            let fixedContent = buildContent(raw: raw, ids: ids.nested())
            
            // Replace items with fixed content
            content.items = fixedContent.items
            
            // Add an error noting the fix
            let error = NSError(
                domain: "StreamContentBuilder",
                code: 1001,
                userInfo: [NSLocalizedDescriptionKey: "Fixed unclosed code block"]
            )
            content.appendError(error, ids: &ids)
        }
    }
    
    /// Validates the markdown content for completeness
    /// - Parameter markdown: The markdown content to validate
    /// - Returns: True if the markdown is valid and complete
    private func isValidMarkdown(_ markdown: String) -> Bool {
        // Check for balanced code blocks
        let codeBlocks = markdown.components(separatedBy: "```").count - 1
        if codeBlocks % 2 != 0 && codeBlocks > 0 {
            return false
        }
        
        // Check for balanced parentheses in links
        let openParenCount = markdown.filter { $0 == "(" }.count
        let closeParenCount = markdown.filter { $0 == ")" }.count
        if openParenCount != closeParenCount {
            return false
        }
        
        return true
    }
}
