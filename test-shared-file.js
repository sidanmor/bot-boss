const path = require('path');
const os = require('os');
const fs = require('fs');

// Test script to check the shared file functionality
async function testSharedFile() {
    const tempDir = os.tmpdir();
    const sharedFilePath = path.join(tempDir, 'vscode-instances.json');
    
    console.log('Testing shared file functionality...');
    console.log(`Shared file path: ${sharedFilePath}`);
    
    // Check if shared file exists
    if (fs.existsSync(sharedFilePath)) {
        console.log('✅ Shared file exists');
        
        try {
            const content = fs.readFileSync(sharedFilePath, 'utf8');
            const instances = JSON.parse(content);
            
            console.log(`📊 Found ${instances.length} instance(s) in shared file:`);
            
            instances.forEach((instance, index) => {
                console.log(`\n📍 Instance ${index + 1}:`);
                console.log(`   PID: ${instance.pid}`);
                console.log(`   Session ID: ${instance.sessionId}`);
                console.log(`   Name: ${instance.name}`);
                console.log(`   Workspace: ${instance.workspacePath || 'No workspace'}`);
                console.log(`   Last Updated: ${new Date(instance.lastUpdated).toLocaleString()}`);
                console.log(`   Memory: ${instance.memory} MB`);
                
                if (instance.gitInfo?.isGitRepo) {
                    console.log(`   Git Branch: ${instance.gitInfo.branch || 'Unknown'}`);
                    console.log(`   Git Changes: ${instance.gitInfo.hasChanges ? 'Yes' : 'No'}`);
                }
            });
        } catch (error) {
            console.log('❌ Error reading shared file:', error);
        }
    } else {
        console.log('⚠️  Shared file does not exist yet');
        console.log('   This is normal if no VS Code instances with the extension are running');
    }
    
    // Check for lock file
    const lockFilePath = path.join(tempDir, 'vscode-instances.lock');
    if (fs.existsSync(lockFilePath)) {
        console.log('🔒 Lock file exists (may indicate a write operation in progress)');
    } else {
        console.log('🔓 No lock file (file is available for reading/writing)');
    }
}

// Run the test
testSharedFile().catch(console.error);