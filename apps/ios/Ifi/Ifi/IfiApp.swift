//
//  IfiApp.swift
//  Ifi
//
//  Created by Samuel Anozie on 8/25/25.
//

import SwiftUI

@main
struct IfiApp: App {
    // MARK: - Dependencies

    /// Shared API client for the lifetime of the app
    private let apiClient = APIClient(baseURLString: "https://api.ifiai.app")

    var body: some Scene {
        WindowGroup {
            ThreadListView(apiClient: apiClient)
                .preferredColorScheme(.dark) // Force dark theme
        }
    }
}
