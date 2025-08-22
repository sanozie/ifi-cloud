import Foundation

/// Configuration for AI providers
struct ProviderConfig: Codable, Hashable {
    /// Model used for planning
    let plannerModel: String
    
    /// Model used for code generation
    let codegenModel: String
    
    /// Maximum number of tokens to generate
    let maxTokens: Int
    
    /// Timeout in milliseconds
    let timeoutMs: Int
    
    /// Cost cap in USD
    let costCapUsd: Double
    
    /// Initialize with default or custom values
    init(
        plannerModel: String = "gpt-5",
        codegenModel: String = "accounts/fireworks/models/qwen2.5-coder-32b-instruct",
        maxTokens: Int = 8192,
        timeoutMs: Int = 60000,
        costCapUsd: Double = 1.0
    ) {
        self.plannerModel = plannerModel
        self.codegenModel = codegenModel
        self.maxTokens = maxTokens
        self.timeoutMs = timeoutMs
        self.costCapUsd = costCapUsd
    }
    
    /// Default configuration
    static let `default` = ProviderConfig()
    
    /// Configuration with minimal token usage
    static let economical = ProviderConfig(
        maxTokens: 4096,
        costCapUsd: 0.5
    )
    
    /// Configuration with maximum token usage
    static let premium = ProviderConfig(
        maxTokens: 16384,
        costCapUsd: 2.0
    )
}
