/**
 * Test script to verify enhanced GitHub Copilot Chat status detection
 * Run this in VS Code Developer Console to test the updated functionality
 */

// Test the enhanced chat status detection
async function testEnhancedChatStatus() {
    console.log('=== Testing Enhanced GitHub Copilot Chat Status Detection ===');
    
    try {
        // Get the Copilot extensions
        const copilotExtension = vscode.extensions.getExtension('github.copilot');
        const copilotChatExtension = vscode.extensions.getExtension('github.copilot-chat');
        
        console.log('Extension Status:');
        console.log('- Copilot Extension:', !!copilotExtension, copilotExtension?.isActive);
        console.log('- Copilot Chat Extension:', !!copilotChatExtension, copilotChatExtension?.isActive);
        
        if (!copilotExtension && !copilotChatExtension) {
            console.log('❌ No Copilot extensions found');
            return;
        }
        
        const primaryExtension = copilotChatExtension || copilotExtension;
        
        if (!primaryExtension.isActive) {
            console.log('❌ Primary Copilot extension is not active');
            return;
        }
        
        const exports = primaryExtension.exports;
        console.log('\nExtension Exports:');
        console.log('- Available keys:', Object.keys(exports));
        
        // Test the getAPI method specifically
        if (typeof exports.getAPI === 'function') {
            console.log('\n✅ getAPI method found - calling it...');
            
            try {
                const api = exports.getAPI();
                console.log('- API object received:', !!api);
                
                if (api) {
                    console.log('- API keys:', Object.keys(api));
                    
                    // Check for chat-related properties
                    if (api.chat) {
                        console.log('- Chat object found:', Object.keys(api.chat));
                        
                        // Test chat status methods
                        const chatMethods = ['getStatus', 'getChatStatus', 'getState'];
                        for (const method of chatMethods) {
                            if (typeof api.chat[method] === 'function') {
                                try {
                                    const result = api.chat[method]();
                                    console.log(`- api.chat.${method}():`, result);
                                } catch (e) {
                                    console.log(`- api.chat.${method}() error:`, e.message);
                                }
                            }
                        }
                    }
                    
                    // Test general API methods
                    const apiMethods = ['getStatus', 'getChatStatus', 'getState', 'getChatState'];
                    for (const method of apiMethods) {
                        if (typeof api[method] === 'function') {
                            try {
                                const result = api[method]();
                                console.log(`- api.${method}():`, result);
                            } catch (e) {
                                console.log(`- api.${method}() error:`, e.message);
                            }
                        }
                    }
                    
                    // Check for event emitters
                    const eventProperties = ['onDidChangeState', 'onChatStateChange', 'onStatusChange'];
                    for (const prop of eventProperties) {
                        if (api[prop]) {
                            console.log(`- Found event property: ${prop}`);
                        }
                    }
                }
            } catch (apiError) {
                console.log('❌ Error calling getAPI():', apiError.message);
            }
        } else {
            console.log('❌ getAPI method not found in exports');
        }
        
        // Test VS Code Chat API
        console.log('\nVS Code Chat API:');
        const chatApi = vscode.chat;
        if (chatApi) {
            console.log('✅ VS Code Chat API available');
            console.log('- Chat API keys:', Object.keys(chatApi));
            
            // Check for state and activity indicators
            const stateProperties = ['state', 'isResponding', 'isGenerating', 'isActive'];
            for (const prop of stateProperties) {
                if (chatApi[prop] !== undefined) {
                    console.log(`- ${prop}:`, chatApi[prop]);
                }
            }
        } else {
            console.log('❌ VS Code Chat API not available');
        }
        
        console.log('\n=== Test Complete ===');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    }
}

// Run the test
testEnhancedChatStatus();