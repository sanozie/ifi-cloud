//
//  StreamContentView.swift
//  Ifi
//
//  Created on 8/26/25.
//

import SwiftUI
import Foundation

/// View for rendering a specific content item based on its type
struct StreamContentItemView: View {
    /// The content item to render
    let item: StreamContentItem<StreamItemValue>
    
    var body: some View {
        switch item.value {
        case .markdown(let entry):
            MarkdownEntryView(entry: entry)
                .padding(.horizontal)
                .transition(.opacity)
                .id(item.id) // Ensures proper animation when content changes
                
        case .markdownTable(let table):
            MarkdownTableView(table: table)
                .transition(.opacity)
                .id(item.id)
                
        case .codeBlock(let codeBlock):
            CodeBlockView(codeBlock: codeBlock)
                .padding(.horizontal)
                .transition(.opacity)
                .id(item.id)
                
        case .xml:
            // XML is not rendered directly
            EmptyView()
        }
    }
}

/// View for rendering a markdown entry
struct MarkdownEntryView: View {
    /// The markdown entry to render
    let entry: MarkdownEntry
    
    /// Whether the entry is expanded (for collapsible entries)
    @State private var isExpanded: Bool
    
    init(entry: MarkdownEntry) {
        self.entry = entry
        // Initialize state with the entry's expansion state
        _isExpanded = State(initialValue: entry.isExpanded)
    }
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if entry.isCollapsible {
                // Collapsible header
                Button {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        isExpanded.toggle()
                    }
                } label: {
                    HStack {
                        Text(isExpanded ? "▼" : "▶")
                            .font(.system(size: 12, weight: .bold))
                        
                        Text("Details")
                            .font(.headline)
                    }
                    .foregroundColor(.accentColor)
                }
                .buttonStyle(.plain)
                
                if isExpanded {
                    // Content is only shown when expanded
                    MarkdownText(markdown: entry.content)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            } else {
                // Regular non-collapsible content
                MarkdownText(markdown: entry.content)
            }
        }
        .padding(.vertical, 4)
    }
}

/// View for rendering a markdown table
struct MarkdownTableView: View {
    /// The markdown table to render
    let table: MarkdownTable
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title = table.title {
                Text(title)
                    .font(.headline)
                    .padding(.horizontal)
            }
            
            // Use the MarkdownText component to render the table
            MarkdownText(markdown: table.content)
                .padding(.horizontal)
            
            if let caption = table.caption {
                Text(caption)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .padding(.horizontal)
            }
        }
        .padding(.vertical, 8)
        .background(Color(UIColor.secondarySystemBackground))
        .cornerRadius(8)
        .padding(.horizontal)
    }
}

/// View for rendering a code block with syntax highlighting
struct CodeBlockView: View {
    /// The code block to render
    let codeBlock: CodeBlock
    
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let title = codeBlock.title {
                Text(title)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            
            if let language = codeBlock.language {
                Text(language)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(Color(UIColor.tertiarySystemBackground))
                    .cornerRadius(4)
            }
            
            ScrollView(.horizontal, showsIndicators: false) {
                Text(codeBlock.code)
                    .font(.system(.body, design: .monospaced))
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Color(UIColor.tertiarySystemBackground))
            .cornerRadius(8)
        }
        .padding(.vertical, 8)
    }
}

/// Main view for rendering a stream of content items
struct StreamContentView: View {
    /// The stream content to render
    let content: StreamContent
    
    /// Animation duration for content changes
    private let animationDuration: Double = 0.3
    
    var body: some View {
        LazyVStack(alignment: .leading, spacing: 12) {
            ForEach(content.items) { item in
                StreamContentItemView(item: item)
            }
        }
        .animation(.easeInOut(duration: animationDuration), value: content.items)
        .padding(.bottom, 16)
    }
}

/// Preview provider for StreamContentView
struct StreamContentView_Previews: PreviewProvider {
    static var previews: some View {
        let markdownEntry = MarkdownEntry(content: "# Hello World\nThis is a sample markdown entry with **bold** and *italic* text.")
        // Unused variable placeholder to silence warnings
        let _ = CodeBlock(code: "func hello() {\n    print(\"Hello, world!\")\n}", language: "swift", title: "Example Function")
        let tableContent = """
        | Name | Age | Role |
        |------|-----|------|
        | John | 30  | Developer |
        | Jane | 28  | Designer |
        """
        let markdownTable = MarkdownTable(content: tableContent, title: "Team Members")
        
        var ids: any IdentifierGenerator = IncrementalIdentifierGenerator.create()
        var content = StreamContent()
        content.appendMarkdown(markdownEntry, ids: &ids)
        content.appendMarkdownTable(markdownTable, ids: &ids)
        
        return StreamContentView(content: content)
            .padding()
            .previewLayout(.sizeThatFits)
    }
}
