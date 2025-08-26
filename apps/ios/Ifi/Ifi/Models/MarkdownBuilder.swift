//
//  MarkdownBuilder.swift
//  Ifi
//
//  Created on 8/26/25.
//

import Foundation

/// Builds structured content from raw markdown text by parsing and organizing it into tables and markdown entries
struct MarkdownBuilder {
    /// The raw markdown text to be parsed
    var rawMarkdown: String
    
    /// Last valid markdown content (for recovery from partial content)
    private var lastValidContent: String = ""
    
    /// Container for parsed markdown content items including tables and markdown entries
    struct Content {
        /// Array of content items that can be either markdown tables or markdown entries
        var items: [StreamContentItem<StreamItemValue>] = []
        
        /// Appends a markdown table to the content items
        /// - Parameters:
        ///   - table: The markdown table to append
        ///   - ids: Generator for creating unique identifiers
        mutating func append(table: MarkdownTable, ids: inout IdentifierGenerator) {
            let item = StreamContentItem<StreamItemValue>(ids: &ids, value: .markdownTable(table))
            items.append(item)
        }
        
        /// Appends a markdown entry to the content items
        /// - Parameters:
        ///   - markdown: The markdown entry to append
        ///   - ids: Generator for creating unique identifiers
        mutating func append(markdown: MarkdownEntry, ids: inout IdentifierGenerator) {
            let item = StreamContentItem<StreamItemValue>(ids: &ids, value: .markdown(markdown))
            items.append(item)
        }
        
        /// Appends a code block to the content items
        /// - Parameters:
        ///   - codeBlock: The code block to append
        ///   - ids: Generator for creating unique identifiers
        mutating func append(codeBlock: CodeBlock, ids: inout IdentifierGenerator) {
            let item = StreamContentItem<StreamItemValue>(ids: &ids, value: .codeBlock(codeBlock))
            items.append(item)
        }
    }
    
    /// Initialize with raw markdown content
    /// - Parameter rawMarkdown: The markdown text to parse
    init(rawMarkdown: String) {
        self.rawMarkdown = rawMarkdown
    }
    
    /// Removes leading and trailing whitespace and newlines from the raw markdown
    mutating func cleanup() {
        rawMarkdown = rawMarkdown.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    
    /// Validates the markdown content for completeness and correctness
    /// - Returns: True if the markdown is valid
    func validate() -> Bool {
        // Check for balanced code blocks
        let codeBlocks = rawMarkdown.components(separatedBy: "```").count - 1
        if codeBlocks % 2 != 0 && codeBlocks > 0 {
            return false
        }
        
        // Check for balanced parentheses in links
        let openParenCount = rawMarkdown.filter { $0 == "(" }.count
        let closeParenCount = rawMarkdown.filter { $0 == ")" }.count
        if openParenCount != closeParenCount {
            return false
        }
        
        return true
    }
    
    /// Attempts to fix common markdown issues
    /// - Returns: Fixed markdown content
    func fixMarkdown() -> String {
        var fixedContent = rawMarkdown
        
        // Fix unclosed code blocks
        let codeBlocks = fixedContent.components(separatedBy: "```").count - 1
        if codeBlocks % 2 != 0 && codeBlocks > 0 {
            fixedContent += "\n```"
        }
        
        return fixedContent
    }
    
    /// Builds structured content from the raw markdown by parsing it into tables and markdown entries
    /// - Parameter nestedIds: Generator for creating unique identifiers
    /// - Returns: A Content object containing the parsed markdown as structured items
    mutating func build(ids nestedIds: IdentifierGenerator) -> Content {
        var ids = nestedIds
        var content = Content()
        
        // Validate markdown and fix if needed
        let markdownText = validate() ? rawMarkdown : fixMarkdown()
        
        // Store as last valid content for recovery
        // Removed the assignment to lastValidContent to fix compilation error
        
        // Split content by sections
        let sections = splitIntoSections(markdownText)
        
        for section in sections {
            if isTable(section) {
                // Process as table
                if let table = extractTable(from: section) {
                    content.append(table: table, ids: &ids)
                } else {
                    // Fallback to regular markdown if table extraction fails
                    let entry = MarkdownEntry(content: section)
                    content.append(markdown: entry, ids: &ids)
                }
            } else if isCodeBlock(section) {
                // Process as code block
                if let codeBlock = extractCodeBlock(from: section) {
                    content.append(codeBlock: codeBlock, ids: &ids)
                } else {
                    // Fallback to regular markdown if code block extraction fails
                    let entry = MarkdownEntry(content: section)
                    content.append(markdown: entry, ids: &ids)
                }
            } else {
                // Process as regular markdown
                let entry = MarkdownEntry(content: section)
                content.append(markdown: entry, ids: &ids)
            }
        }
        
        return content
    }
    
    /// Splits the markdown content into logical sections
    /// - Parameter markdown: The markdown content to split
    /// - Returns: Array of markdown sections
    private func splitIntoSections(_ markdown: String) -> [String] {
        // For simple implementation, we'll split by tables and code blocks
        // In a more sophisticated implementation, this would use proper markdown parsing
        
        var sections: [String] = []
        var currentSection = ""
        
        // Split by lines for processing
        let lines = markdown.components(separatedBy: .newlines)
        var inCodeBlock = false
        var tableStartIndex: Int? = nil
        
        for (index, line) in lines.enumerated() {
            // Handle code blocks
            if line.hasPrefix("```") {
                inCodeBlock.toggle()
                
                if inCodeBlock {
                    // Starting a new code block
                    if !currentSection.isEmpty {
                        sections.append(currentSection)
                        currentSection = ""
                    }
                    currentSection += line + "\n"
                } else {
                    // Ending a code block
                    currentSection += line + "\n"
                    sections.append(currentSection)
                    currentSection = ""
                }
                continue
            }
            
            // If we're in a code block, just add the line
            if inCodeBlock {
                currentSection += line + "\n"
                continue
            }
            
            // Handle tables
            if line.contains("|") && line.contains("-") && line.contains("|") {
                // This might be a table header separator
                if tableStartIndex == nil {
                    // Check if previous line might be a table header
                    if index > 0 && lines[index-1].contains("|") {
                        // This is likely a table - add previous content as a section
                        if !currentSection.isEmpty {
                            let tableHeaderLine = lines[index-1]
                            // Remove the table header from current section
                            if currentSection.hasSuffix(tableHeaderLine + "\n") {
                                currentSection = String(currentSection.dropLast(tableHeaderLine.count + 1))
                            }
                            
                            if !currentSection.isEmpty {
                                sections.append(currentSection)
                            }
                            
                            // Start a new section for the table
                            currentSection = tableHeaderLine + "\n" + line + "\n"
                            tableStartIndex = index - 1
                        } else {
                            // Start with the table header
                            currentSection = lines[index-1] + "\n" + line + "\n"
                            tableStartIndex = index - 1
                        }
                    }
                }
                continue
            }
            
            // If we're tracking a table and this line has pipes, it's part of the table
            if tableStartIndex != nil && line.contains("|") {
                currentSection += line + "\n"
                continue
            }
            
            // If we were tracking a table but this line doesn't have pipes, the table is done
            if tableStartIndex != nil && !line.contains("|") {
                tableStartIndex = nil
                sections.append(currentSection)
                currentSection = line + "\n"
                continue
            }
            
            // Regular line
            currentSection += line + "\n"
        }
        
        // Add any remaining content
        if !currentSection.isEmpty {
            sections.append(currentSection)
        }
        
        return sections
    }
    
    /// Checks if a section of text is a markdown table
    /// - Parameter text: The text to check
    /// - Returns: True if the text appears to be a markdown table
    private func isTable(_ text: String) -> Bool {
        // Check for table markers: must have pipe characters and header separator
        let lines = text.components(separatedBy: .newlines)
        
        // Need at least 3 lines for a proper table (header, separator, data)
        guard lines.count >= 3 else { return false }
        
        // Check for header separator line (e.g., |---|---|)
        var hasSeparator = false
        for line in lines {
            if line.contains("|") && line.contains("-") && !line.contains("|--") {
                // This is likely not a separator line but content with hyphens
                continue
            }
            if line.contains("|") && line.contains("-") {
                hasSeparator = true
                break
            }
        }
        
        // Must have pipes in multiple lines and a separator
        let pipeLines = lines.filter { $0.contains("|") }.count
        return pipeLines >= 2 && hasSeparator
    }
    
    /// Extracts a markdown table from text
    /// - Parameter text: The text containing a table
    /// - Returns: A MarkdownTable object if extraction succeeds
    private func extractTable(from text: String) -> MarkdownTable? {
        guard isTable(text) else { return nil }
        
        // Extract title if present (line before table that doesn't have pipes)
        var title: String? = nil
        let lines = text.components(separatedBy: .newlines)
        
        // Find the first line with a pipe (table start)
        if let firstTableLineIndex = lines.firstIndex(where: { $0.contains("|") }),
           firstTableLineIndex > 0 {
            // Check if previous line might be a title
            let previousLine = lines[firstTableLineIndex - 1].trimmingCharacters(in: .whitespacesAndNewlines)
            if !previousLine.isEmpty && !previousLine.contains("|") {
                title = previousLine
            }
        }
        
        return MarkdownTable(content: text, title: title)
    }
    
    /// Checks if a section of text is a code block
    /// - Parameter text: The text to check
    /// - Returns: True if the text appears to be a code block
    private func isCodeBlock(_ text: String) -> Bool {
        // Check for code block markers
        guard text.hasPrefix("```") else { return false }
        // Look for a closing ``` somewhere after the opening line
        let remainder = text.dropFirst(3)
        return remainder.contains("```")
    }
    
    /// Extracts a code block from text
    /// - Parameter text: The text containing a code block
    /// - Returns: A CodeBlock object if extraction succeeds
    private func extractCodeBlock(from text: String) -> CodeBlock? {
        guard isCodeBlock(text) else { return nil }
        
        // Extract language if specified
        var language: String? = nil
        var code = text
        
        // Remove opening ```language line
        if let firstNewline = text.firstIndex(of: "\n") {
            let firstLine = text[text.startIndex..<firstNewline]
            code = String(text[firstNewline...])
            
            // Extract language from opening ```
            if firstLine.count > 3 {
                language = String(firstLine.dropFirst(3)).trimmingCharacters(in: .whitespacesAndNewlines)
                if language?.isEmpty == true {
                    language = nil
                }
            }
        }
        
        // Remove closing ```
        if let lastBackticks = code.range(of: "```", options: .backwards) {
            code = String(code[..<lastBackticks.lowerBound])
        }
        
        // Trim whitespace
        code = code.trimmingCharacters(in: .whitespacesAndNewlines)
        
        return CodeBlock(code: code, language: language)
    }
    
    /// Recovers from partial or invalid markdown
    /// - Returns: The best available content
    func recoverContent() -> String {
        if !lastValidContent.isEmpty {
            return lastValidContent
        }
        return fixMarkdown()
    }
}
