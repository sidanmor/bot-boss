/**
 * Debug script to test the enhanced Copilot Chat monitoring
 * 
 * Run this in VS Code Developer Console or add to your extension for debugging
 */

// This should be added to your extension.ts for testing
function testCopilotChatMonitoring() {
    console.log('=== Testing Enhanced Copilot Chat Monitoring ===');
    
    const copilotService = require('./copilotStatusService').CopilotStatusService.getInstance();
    
    // Enable debug logging
    process.env.BOT_BOSS_DEBUG = 'true';
    
    console.log('1. Running debug method to see available extensions...');
    copilotService.debugCopilotExtensions();
    
    console.log('\n2. Getting current status...');
    const currentStatus = copilotService.getCurrentStatus();
    console.log('Current status:', currentStatus);
    
    console.log('\n3. Getting current chat status...');
    const chatStatus = copilotService.getCurrentChatStatus();
    console.log('Chat status:', chatStatus);
    
    console.log('\n4. Starting monitoring...');
    copilotService.start();
    
    // Listen for status changes
    copilotService.onStatusChange((status) => {
        const chatInfo = status.chat || {};
        console.log('Status changed:', {
            main: status.status,
            chat: chatInfo,
            detail: status.detailHint
        });
        
        if (chatInfo.isResponding) {
            console.log('🔥 CHAT IS RESPONDING! 🔥');
        }
    });
    
    console.log('\n5. Forcing a refresh every 3 seconds for testing...');
    const testInterval = setInterval(() => {
        console.log('--- Refresh ---');
        copilotService.refresh().then(status => {
            if (status) {
                const chatInfo = status.chat || {};
                console.log('Refreshed status:', {
                    main: status.status,
                    chat: chatInfo.state,
                    responding: chatInfo.isResponding
                });
            }
        });
    }, 3000);
    
    // Stop testing after 1 minute
    setTimeout(() => {
        clearInterval(testInterval);
        copilotService.stop();
        console.log('=== Test completed ===');
    }, 60000);
}

// Instructions for manual testing:
console.log(`
=== MANUAL TESTING INSTRUCTIONS ===

1. Add this code to your extension.ts activate() function:
   
   // Debug Copilot Chat monitoring
   const copilotService = CopilotStatusService.getInstance();
   copilotService.debugCopilotExtensions();
   copilotService.start();
   
   copilotService.onStatusChange((status) => {
       console.log('Copilot status:', status.status, (status as any).chat);
   });

2. Open VS Code Developer Console (Help > Toggle Developer Tools > Console)

3. Start a Copilot Chat conversation

4. Watch the console for log messages showing:
   - Extension exports available
   - Chat session data
   - Status changes when chat is responding

5. Try different scenarios:
   - Ask Copilot Chat a question
   - Use inline chat
   - Generate code with Copilot
   - Explain code with Copilot

The enhanced monitoring should now detect:
- Extension state changes
- Chat session activity
- Real-time status from extension exports
- Alternative detection methods

Look for these log messages:
- "[BotBoss] Chat is responding - updating main status to Generating"
- "[BotBoss] Found chat activity indicator"
- "[BotBoss] Found X chat sessions"
- "🔥 CHAT IS RESPONDING! 🔥"
`);

module.exports = { testCopilotChatMonitoring };