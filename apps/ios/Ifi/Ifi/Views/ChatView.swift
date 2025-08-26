//
//  ChatView.swift
//  Ifi
//
//  Created on 8/25/25.
//

import SwiftUI
// SwiftData removed – data now fetched via API

struct ChatView: View {
    // MARK: - Properties
    
    @Bindable var viewModel: ChatViewModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var scrollTarget: String?
    @State private var messageInputHeight: CGFloat = 40
    @FocusState private var isInputFocused: Bool
    
    // MARK: - Constants
    
    private let maxInputHeight: CGFloat = 120
    private let minInputHeight: CGFloat = 40
    private let scrollToBottomThreshold: CGFloat = 200
    private let typingIndicatorId = "typingIndicator"
    
    // MARK: - Body
    
    var body: some View {
        ZStack(alignment: .bottom) {
            // Chat messages
            messagesView
                .padding(.bottom, 60) // Space for input bar
            
            VStack(spacing: 0) {
                Spacer()
                
                // Input bar
                inputBar
                    .background(
                        colorScheme == .dark ? 
                            Color(.systemBackground) : 
                            Color(.secondarySystemBackground)
                    )
                    .shadow(color: Color.black.opacity(0.1), radius: 5, x: 0, y: -2)
            }
        }
        .navigationTitle(viewModel.currentThread?.title ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
        // Use standard toolbar modifier for broader compatibility
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if viewModel.isStreaming {
                    Button("Stop") {
                        viewModel.cancelStreaming()
                    }
                    .foregroundColor(.red)
                    .accessibilityLabel("Stop response")
                } else {
                    // Refresh button - only shown when not streaming
                    Button {
                        Task {
                            await viewModel.refresh()
                        }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .disabled(viewModel.isLoading)
                    .accessibilityLabel("Refresh conversation")
                }
            }
        }
        .alert("Error", isPresented: $viewModel.showError) {
            Button("Dismiss", role: .cancel) { }
        } message: {
            Text(viewModel.errorMessage ?? "An unknown error occurred")
        }
        // No debug logging in production code
    }
    
    // MARK: - Message List
    
    private var messagesView: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(viewModel.messages) { message in
                    MessageBubble(message: message, colorScheme: colorScheme)
                        .id(message.id)
                }
                
                // Streaming / typing indicator logic
                // Show streaming content when available
                if viewModel.isStreaming && !viewModel.streamContent.items.isEmpty {
                    StreamContentView(content: viewModel.streamContent)
                        .id(typingIndicatorId)
                }

                // Show typing indicator while request is loading
                if viewModel.isLoading {
                    TypingIndicator()
                        .id(typingIndicatorId)
                }
                
                // Invisible spacer view for scrolling target
                Color.clear
                    .frame(height: 1)
                    .id("bottomScrollAnchor")
            }
            .padding(.horizontal)
            .padding(.top, 12)
            .padding(.bottom, 8)
        }
        .refreshable {
            // Pull-to-refresh functionality
            await viewModel.refresh()
        }
        .scrollPosition(id: $scrollTarget)
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.immediately)
        .onAppear {
            scrollToBottom(animated: false)
        }
        .onChange(of: viewModel.messages.count) { 
            scrollToBottom()
        }
        .onChange(of: viewModel.streamContent.items.count) { _ in
            scrollToBottom()
        }
        .onChange(of: viewModel.isLoading) { 
            scrollToBottom()
        }
    }
    
    // MARK: - Input Bar
    
    private var inputBar: some View {
        VStack(spacing: 0) {
            Divider()
            
            HStack(alignment: .bottom, spacing: 10) {
                // Text input field
                ZStack(alignment: .leading) {
                    // Background
                    RoundedRectangle(cornerRadius: 18)
                        .fill(colorScheme == .dark ? 
                              Color.secondary.opacity(0.2) : 
                              Color.secondary.opacity(0.1))
                    
                    // Text input
                    TextField("Message", text: $viewModel.inputText, axis: .vertical)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .frame(minHeight: minInputHeight, maxHeight: maxInputHeight)
                        .background(Color.clear)
                        .focused($isInputFocused)
                        .lineLimit(5)
                        .onChange(of: viewModel.inputText) {
                            // Adjust height based on content
                            let size = CGSize(
                                width: UIScreen.main.bounds.width - 100,
                                height: .infinity
                            )
                            let estimatedHeight = viewModel.inputText.boundingRect(
                                with: size,
                                options: .usesLineFragmentOrigin,
                                attributes: [.font: UIFont.preferredFont(forTextStyle: .body)],
                                context: nil
                            ).height + 24

                            // Clamp input height between min/max bounds
                            messageInputHeight = min(
                                max(estimatedHeight, minInputHeight),
                                maxInputHeight
                            )
                        }
                        .animation(.spring, value: messageInputHeight)
                        .accessibilityLabel("Message input")
                }
                .frame(height: messageInputHeight)
                
                // Send button
                Button {
                    viewModel.sendMessage()
                    isInputFocused = false
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .resizable()
                        .frame(width: 32, height: 32)
                        .foregroundColor(.accentColor)
                        .contentShape(Circle())
                }
                // Disable only while the current request is being sent (`isLoading`)
                // so users can queue another message while a previous one is still streaming.
                .disabled(viewModel.inputText.isEmpty || viewModel.isLoading)
                .opacity(viewModel.inputText.isEmpty ? 0.5 : 1.0)
                .accessibilityLabel("Send message")
                .buttonStyle(.plain)
                .sensoryFeedback(.impact, trigger: viewModel.inputText.isEmpty ? nil : true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
    }
    
    // MARK: - Helper Methods
    
    private func scrollToBottom(animated: Bool = true) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            scrollTarget = "bottomScrollAnchor"
        }
    }
}

// MARK: - Message Bubble

struct MessageBubble: View {
    let message: ChatMessageViewModel
    var isStreaming: Bool = false
    let colorScheme: ColorScheme
    
    private var isFromUser: Bool {
        return message.role == .user
    }
    
    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isFromUser {
                Spacer(minLength: 60)
            }
            
            VStack(alignment: isFromUser ? .trailing : .leading, spacing: 4) {
                // Message content
                Group {
                    // Assistant messages (final, not streaming) render Markdown
                    if !isFromUser {
                        MarkdownText(markdown: message.content)
                    } else {
                        // User messages and live-streaming chunks render plain text
                        Text(message.content)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(isFromUser ?
                              Color.secondary.opacity(0.2) :
                                Color.clear
                        )
                }
                .foregroundStyle(isFromUser ? .white : .primary)
                .textSelection(.enabled)
                .contextMenu {
                    Button {
                        UIPasteboard.general.string = message.content
                    } label: {
                        Label("Copy", systemImage: "doc.on.doc")
                    }
                }
                
                // Timestamp
                if !isStreaming {
                    Text(message.formattedTime)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 4)
                }
            }
            
            if !isFromUser {
                Spacer(minLength: 60)
            }
        }
        .padding(.vertical, 2)
        .id(message.id)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(isFromUser ? "You" : "Assistant") said \(message.content)")
        .accessibilityHint(isFromUser ? "Your message" : "Assistant's response")
    }
}

// MARK: - Markdown Renderer

/// Lightweight Markdown renderer that falls back to plain text on failure.
/// Uses `AttributedString(markdown:)`, available from iOS 15+.
struct MarkdownText: View {
    let markdown: String
    
    var body: some View {
        if let attributed = try? AttributedString(markdown: markdown) {
            Text(attributed)
        } else {
            // Fallback for malformed Markdown
            Text(markdown)
        }
    }
}

// MARK: - Typing Indicator

struct TypingIndicator: View {
    @State private var animationOffset: CGFloat = 0
    
    var body: some View {
        HStack(spacing: 12) {
            // Animated dots
            HStack(spacing: 4) {
                ForEach(0..<3) { index in
                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 8, height: 8)
                        .offset(y: animationOffset(for: index))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background {
                RoundedRectangle(cornerRadius: 18)
                    .fill(Color.secondary.opacity(0.1))
            }
            
            Spacer()
        }
        .padding(.vertical, 4)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.8).repeatForever()) {
                animationOffset = 1
            }
        }
        .accessibilityLabel("Assistant is typing")
    }
    
    private func animationOffset(for index: Int) -> CGFloat {
        let baseDelay = 0.2
        let delay = baseDelay * Double(index)
        return sin(animationOffset + .pi * 2 * delay) * 5
    }
}

// MARK: - String Extension

extension String {
    func boundingRect(with size: CGSize, options: NSStringDrawingOptions, attributes: [NSAttributedString.Key: Any]?, context: NSStringDrawingContext?) -> CGRect {
        return (self as NSString).boundingRect(with: size, options: options, attributes: attributes, context: context)
    }
}

// MARK: - Preview

#Preview {
    NavigationStack {
        let apiClient = APIClient(baseURLString: "http://localhost:3000")
        let vm = ChatViewModel(apiClient: apiClient)
        vm.messages = [
            ChatMessageViewModel(content: "Hello! How can I help you today?", role: .assistant, timestamp: Date().addingTimeInterval(-3600)),
            ChatMessageViewModel(content: "I need help implementing a new feature in my app.", role: .user, timestamp: Date().addingTimeInterval(-3500)),
            ChatMessageViewModel(content: "Sure, I'd be happy to help. What kind of feature are you trying to implement?", role: .assistant, timestamp: Date().addingTimeInterval(-3400)),
            ChatMessageViewModel(content: "I want to add a chat interface that can stream responses from an AI API.", role: .user, timestamp: Date().addingTimeInterval(-3300))
        ]
        return ChatView(viewModel: vm)
            .preferredColorScheme(.dark)
    }
}
