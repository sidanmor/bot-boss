/**
 * Test script to demonstrate GitHub Copilot Chat monitoring
 * 
 * This shows how the CopilotStatusService now monitors both:
 * 1. Core Copilot extension status
 * 2. GitHub Copilot Chat status using vscode.chat.onDidChangeState API
 */

// Mock VS Code chat API for testing
const mockChatAPI = {
    state: 'idle',
    isResponding: false,
    participants: [],
    
    // Event emitter for state changes
    onDidChangeState: (callback) => {
        console.log('Chat state listener registered');
        
        // Simulate state changes
        setTimeout(() => {
            mockChatAPI.state = 'responding';
            mockChatAPI.isResponding = true;
            callback({ state: 'responding' });
        }, 2000);
        
        setTimeout(() => {
            mockChatAPI.state = 'idle';
            mockChatAPI.isResponding = false;
            callback({ state: 'idle' });
        }, 5000);
        
        return {
            dispose: () => console.log('Chat listener disposed')
        };
    },
    
    onDidAddParticipant: (callback) => {
        console.log('Chat participant add listener registered');
        return {
            dispose: () => console.log('Chat participant add listener disposed')
        };
    },
    
    onDidRemoveParticipant: (callback) => {
        console.log('Chat participant remove listener registered');
        return {
            dispose: () => console.log('Chat participant remove listener disposed')
        };
    }
};

function demonstrateChatMonitoring() {
    console.log('=== GitHub Copilot Chat Monitoring Demo ===\n');
    
    // Example of how the enhanced CopilotStatusService works
    console.log('1. Setting up chat state monitoring...');
    
    // The service now automatically listens for chat state changes
    const chatListener = mockChatAPI.onDidChangeState((event) => {
        console.log(`2. Chat state changed to: ${event.state}`);
        
        // The service would now:
        // - Update its internal chat state
        // - Trigger a new poll to refresh status
        // - Fire events to notify UI components
        
        console.log('   -> Triggering status refresh...');
        console.log('   -> Notifying UI components...');
        
        if (event.state === 'responding') {
            console.log('   -> Main Copilot status updated to "Generating"');
            console.log('   -> Detail hint: "Copilot Chat is responding"');
        } else if (event.state === 'idle') {
            console.log('   -> Main Copilot status updated to "Idle"');
            console.log('   -> Chat activity completed');
        }
    });
    
    console.log('\n3. Waiting for chat activity...\n');
    
    // Clean up after demo
    setTimeout(() => {
        chatListener.dispose();
        console.log('\n=== Demo completed ===');
        console.log('\nThe enhanced CopilotStatusService now provides:');
        console.log('- Real-time chat state monitoring');
        console.log('- Integration with core Copilot status');
        console.log('- Extended status information including chat activity');
        console.log('- Automatic status updates when chat state changes');
    }, 6000);
}

// Export the mock for use in actual VS Code extension
module.exports = {
    demonstrateChatMonitoring,
    mockChatAPI
};

// Run demo if this file is executed directly
if (require.main === module) {
    demonstrateChatMonitoring();
}