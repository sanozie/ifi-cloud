import Foundation

/// Role of a message in a conversation
enum MessageRole: String, Codable, Hashable {
    case user
    case assistant
    case system
}

/// A message in a conversation thread
struct Message: Identifiable, Codable, Hashable {
    /// Unique identifier
    let id: String
    
    /// Role of the message sender
    let role: MessageRole
    
    /// Content of the message
    let content: String
    
    /// Timestamp when the message was created
    let createdAt: Date
    
    /// Optional metadata associated with the message
    let metadata: [String: AnyHashable]?
    
    /// Initialize a new message
    init(id: String = UUID().uuidString, 
         role: MessageRole, 
         content: String, 
         createdAt: Date = Date(), 
         metadata: [String: AnyHashable]? = nil) {
        self.id = id
        self.role = role
        self.content = content
        self.createdAt = createdAt
        self.metadata = metadata
    }
    
    // Custom Codable implementation for AnyHashable metadata
    enum CodingKeys: String, CodingKey {
        case id, role, content, createdAt, metadata
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        role = try container.decode(MessageRole.self, forKey: .role)
        content = try container.decode(String.self, forKey: .content)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        
        // Decode metadata as [String: Any] if present
        if container.contains(.metadata) {
            let metadataDict = try container.decode([String: AnyCodable].self, forKey: .metadata)
            metadata = metadataDict.mapValues { $0.value as? AnyHashable ?? $0.value }
        } else {
            metadata = nil
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(role, forKey: .role)
        try container.encode(content, forKey: .content)
        try container.encode(createdAt, forKey: .createdAt)
        
        // Encode metadata if present
        if let metadata = metadata {
            let encodableMetadata = metadata.mapValues { AnyCodable($0) }
            try container.encode(encodableMetadata, forKey: .metadata)
        }
    }
}

/// Helper for encoding/decoding arbitrary values
struct AnyCodable: Codable, Hashable {
    let value: Any
    
    init(_ value: Any) {
        self.value = value
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        
        if container.decodeNil() {
            self.value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            self.value = bool
        } else if let int = try? container.decode(Int.self) {
            self.value = int
        } else if let double = try? container.decode(Double.self) {
            self.value = double
        } else if let string = try? container.decode(String.self) {
            self.value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            self.value = array.map { $0.value }
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            self.value = dict.mapValues { $0.value }
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "AnyCodable cannot decode value")
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        
        switch value {
        case is NSNull, is Void:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map { AnyCodable($0) })
        case let dict as [String: Any]:
            try container.encode(dict.mapValues { AnyCodable($0) })
        default:
            let context = EncodingError.Context(codingPath: container.codingPath, 
                                               debugDescription: "AnyCodable cannot encode \(type(of: value))")
            throw EncodingError.invalidValue(value, context)
        }
    }
    
    static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        return String(describing: lhs.value) == String(describing: rhs.value)
    }
    
    func hash(into hasher: inout Hasher) {
        hasher.combine(String(describing: value))
    }
}
