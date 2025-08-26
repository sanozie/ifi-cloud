//
//  IdentifiableError.swift
//  Ifi
//
//  Created on 8/26/25.
//

import Foundation
import SwiftUI

/// A wrapper that makes any Error identifiable for SwiftUI
/// 
/// This allows errors to be uniquely identified, displayed in lists,
/// and tracked throughout the streaming pipeline.
public struct IdentifiableError: Identifiable, Equatable, Sendable {
    /// The unique identifier for this error
    public let id: IdentifierGenerator.ID
    
    /// The underlying error that was wrapped
    public let underlyingError: Error
    
    /// Creates a new identifiable error with a generated ID
    /// - Parameters:
    ///   - ids: Generator for creating unique identifiers
    ///   - underlyingError: The error to wrap
    public init(ids: inout IdentifierGenerator, underlyingError: Error) {
        self.id = ids()
        self.underlyingError = underlyingError
    }
    
    /// Creates a new identifiable error with a specific ID
    /// - Parameters:
    ///   - id: The unique identifier to use
    ///   - underlyingError: The error to wrap
    public init(id: IdentifierGenerator.ID, underlyingError: Error) {
        self.id = id
        self.underlyingError = underlyingError
    }
    
    /// Compares two identifiable errors for equality based on their IDs
    /// - Parameters:
    ///   - lhs: The first error to compare
    ///   - rhs: The second error to compare
    /// - Returns: True if the errors have the same ID
    public static func == (lhs: IdentifiableError, rhs: IdentifiableError) -> Bool {
        return lhs.id == rhs.id
    }
    
    /// Returns a localized description of the error
    public var localizedDescription: String {
        if let error = underlyingError as? LocalizedError, let errorDescription = error.errorDescription {
            return errorDescription
        }
        return underlyingError.localizedDescription
    }
}

// MARK: - Hashable Extension

extension IdentifiableError: Hashable {
    /// Hashes the error ID for use in collections
    /// - Parameter hasher: The hasher to use
    public func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

// MARK: - CustomStringConvertible Extension

extension IdentifiableError: CustomStringConvertible {
    /// A textual representation of the error
    public var description: String {
        return "[\(id)] \(localizedDescription)"
    }
}

// MARK: - Error Convenience Extensions

extension Error {
    /// Wraps this error in an IdentifiableError with a unique ID
    /// - Parameter ids: Generator for creating unique identifiers
    /// - Returns: An identifiable version of this error
    public func identifiable(ids: inout IdentifierGenerator) -> IdentifiableError {
        return IdentifiableError(ids: &ids, underlyingError: self)
    }
}
