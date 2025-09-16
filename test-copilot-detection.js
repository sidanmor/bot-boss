// Test script to verify GitHub Copilot detection logic
// This simulates how our extension would detect GitHub Copilot

async function testCopilotDetection() {
    console.log('Testing GitHub Copilot detection logic...');
    
    try {
        // Simulate checking for GitHub Copilot extension
        const copilotExtensionId = 'github.copilot';
        console.log(`Looking for extension: ${copilotExtensionId}`);
        
        // Test different scenarios that our extension might encounter
        const testScenarios = [
            {
                name: 'Copilot Not Installed',
                extension: null,
                expected: { isInstalled: false, isActive: false, status: 'Disabled' }
            },
            {
                name: 'Copilot Installed but Inactive',
                extension: { isActive: false, packageJSON: { version: '1.0.0' } },
                expected: { isInstalled: true, isActive: false, status: 'Disabled' }
            },
            {
                name: 'Copilot Active and Running',
                extension: { isActive: true, packageJSON: { version: '1.0.0' }, exports: { status: 'running' } },
                expected: { isInstalled: true, isActive: true, status: 'Running' }
            },
            {
                name: 'Copilot Waiting for Approval',
                extension: { isActive: true, packageJSON: { version: '1.0.0' }, exports: { status: 'waiting for approval' } },
                expected: { isInstalled: true, isActive: true, status: 'Waiting for Approval' }
            },
            {
                name: 'Copilot Failed',
                extension: { isActive: true, packageJSON: { version: '1.0.0' }, exports: { status: 'failed' } },
                expected: { isInstalled: true, isActive: true, status: 'Failed' }
            },
            {
                name: 'Copilot Done/Completed',
                extension: { isActive: true, packageJSON: { version: '1.0.0' }, exports: { status: 'completed' } },
                expected: { isInstalled: true, isActive: true, status: 'Done' }
            },
            {
                name: 'Copilot Unknown Status',
                extension: { isActive: true, packageJSON: { version: '1.0.0' }, exports: { status: 'mysterious_status' } },
                expected: { isInstalled: true, isActive: true, status: 'Unknown' }
            }
        ];
        
        console.log('\n🧪 Running Copilot Detection Tests...\n');
        
        let passedTests = 0;
        
        testScenarios.forEach((scenario, index) => {
            console.log(`--- Test ${index + 1}: ${scenario.name} ---`);
            
            const result = simulateCopilotDetection(scenario.extension);
            
            // Basic validation
            const matches = 
                result.isInstalled === scenario.expected.isInstalled &&
                result.isActive === scenario.expected.isActive &&
                result.status === scenario.expected.status;
            
            if (matches) {
                console.log('✅ PASSED');
                passedTests++;
            } else {
                console.log('❌ FAILED');
                console.log('   Result:  ', JSON.stringify(result));
                console.log('   Expected:', JSON.stringify(scenario.expected));
            }
            
            console.log(`   Status: ${getStatusIcon(result.status)} ${result.status}`);
            console.log('');
        });
        
        console.log(`🎯 Test Summary: ${passedTests}/${testScenarios.length} tests passed`);
        
        if (passedTests === testScenarios.length) {
            console.log('🎉 All tests passed! Copilot detection logic is working correctly.');
        } else {
            console.log('⚠️  Some tests failed. Please review the logic.');
        }
        
    } catch (error) {
        console.error('❌ Test suite failed:', error);
    }
}

function simulateCopilotDetection(extension) {
    const copilotInfo = {
        isInstalled: false,
        isActive: false,
        status: 'Unknown'
    };

    if (!extension) {
        copilotInfo.status = 'Disabled';
        return copilotInfo;
    }

    copilotInfo.isInstalled = true;
    copilotInfo.version = extension.packageJSON?.version;

    if (!extension.isActive) {
        copilotInfo.status = 'Disabled';
        return copilotInfo;
    }

    copilotInfo.isActive = true;

    // Simulate status mapping from our extension logic
    if (extension.exports && extension.exports.status) {
        copilotInfo.status = mapCopilotStatus(extension.exports.status);
    } else {
        copilotInfo.status = 'Running';
    }

    return copilotInfo;
}

function mapCopilotStatus(status) {
    if (typeof status === 'string') {
        const statusLower = status.toLowerCase();
        
        if (statusLower.includes('running') || statusLower.includes('active') || statusLower.includes('ready')) {
            return 'Running';
        } else if (statusLower.includes('waiting') || statusLower.includes('pending') || statusLower.includes('approval')) {
            return 'Waiting for Approval';
        } else if (statusLower.includes('failed') || statusLower.includes('error')) {
            return 'Failed';
        } else if (statusLower.includes('done') || statusLower.includes('completed')) {
            return 'Done';
        } else if (statusLower.includes('disabled')) {
            return 'Disabled';
        }
    }

    return 'Unknown';
}

function getStatusIcon(status) {
    switch (status) {
        case 'Running':
            return '🟢';
        case 'Waiting for Approval':
            return '🟡';
        case 'Failed':
            return '🔴';
        case 'Done':
            return '✅';
        case 'Disabled':
            return '⚫';
        default:
            return '❓';
    }
}

// Run the test
testCopilotDetection().catch(console.error);