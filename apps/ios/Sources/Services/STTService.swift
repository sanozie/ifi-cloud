import Foundation
import SwiftUI

/// Speech-to-text service stub for voice input
class STTService: ObservableObject {
    /// Current recording state
    @Published private(set) var isRecording = false
    
    /// Timer for simulating transcription
    private var simulationTimer: Timer?
    
    /// Callback for transcription results
    private var resultCallback: ((String) -> Void)?
    
    /// Sample phrases for simulation
    private let samplePhrases = [
        "Create a React component for a todo list",
        "Help me debug this API connection issue",
        "Generate a database schema for a blog",
        "How do I implement authentication in my app?",
        "Write a unit test for my user service"
    ]
    
    /// Start recording audio for transcription
    /// - Parameter onResult: Callback for transcription results
    func startRecording(onResult: @escaping (String) -> Void) {
        // Store callback
        resultCallback = onResult
        
        // Update state
        isRecording = true
        
        // Simulate "thinking" delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            guard let self = self, self.isRecording else { return }
            
            // Call back with "Listening..." to indicate active recording
            self.resultCallback?("Listening...")
            
            // Create timer to simulate transcription
            self.simulationTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in
                guard let self = self, self.isRecording else { return }
                
                // Select random sample phrase
                let randomPhrase = self.samplePhrases.randomElement() ?? "Help me with my code"
                
                // Call back with result
                self.resultCallback?(randomPhrase)
                
                // Automatically stop recording after delivering result
                self.stopRecording()
            }
        }
        
        print("STT recording started (simulated)")
    }
    
    /// Stop recording audio
    func stopRecording() {
        // Cancel timer
        simulationTimer?.invalidate()
        simulationTimer = nil
        
        // Update state
        isRecording = false
        
        print("STT recording stopped (simulated)")
    }
    
    /// Check if speech recognition is available
    /// - Returns: Always returns true for the stub
    func isSpeechRecognitionAvailable() -> Bool {
        // In a real implementation, this would check SFSpeechRecognizer authorization status
        return true
    }
    
    /// Request speech recognition authorization
    /// - Parameter completion: Callback with authorization result
    func requestSpeechRecognitionAuthorization(completion: @escaping (Bool) -> Void) {
        // In a real implementation, this would request SFSpeechRecognizer authorization
        // For the stub, we'll just simulate success after a short delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            completion(true)
        }
    }
}
