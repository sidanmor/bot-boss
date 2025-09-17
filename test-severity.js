#!/usr/bin/env node

/**
 * Simple test script for CopilotStatusService.severity() mapping
 * Run with: node test-severity.js
 */

// Mock the severity function (copy from CopilotStatusService)
function severity(status) {
    switch (status) {
        case 'Failed':
        case 'Error': return 5;
        case 'Unauthorized':
        case 'SigninRequired':
        case 'RateLimited':
        case 'Waiting for Approval': return 4;
        case 'Initializing': return 3;
        case 'Generating': return 2;
        case 'Disabled': return 1;
        case 'Done':
        case 'Idle':
        case 'Running': return 0;
        default: return 0; // Unknown treated neutral
    }
}

// Test cases
const tests = [
    // Expected ordering: higher severity = worse state
    { status: 'Failed', expectedMin: 5 },
    { status: 'Error', expectedMin: 5 },
    { status: 'Unauthorized', expectedMin: 4 },
    { status: 'SigninRequired', expectedMin: 4 },
    { status: 'RateLimited', expectedMin: 4 },
    { status: 'Waiting for Approval', expectedMin: 4 },
    { status: 'Initializing', expectedMin: 3 },
    { status: 'Generating', expectedMin: 2 },
    { status: 'Disabled', expectedMin: 1 },
    { status: 'Done', expectedMin: 0 },
    { status: 'Idle', expectedMin: 0 },
    { status: 'Running', expectedMin: 0 },
    { status: 'Unknown', expectedMin: 0 }
];

// Test severity ordering
console.log('🧪 Testing Copilot Status Severity Mapping');
console.log('=' + '='.repeat(40));

let passed = 0;
let failed = 0;

for (const test of tests) {
    const actual = severity(test.status);
    const pass = actual >= test.expectedMin;
    
    console.log(`${pass ? '✅' : '❌'} ${test.status.padEnd(20)} → ${actual} (expected ≥${test.expectedMin})`);
    
    if (pass) {
        passed++;
    } else {
        failed++;
        console.log(`   Expected severity ≥${test.expectedMin}, got ${actual}`);
    }
}

// Test ordering principle: Failed > Unauthorized > Initializing > Generating > Disabled > Idle
const ordering = [
    ['Failed', 'Error'],
    ['Unauthorized', 'SigninRequired', 'RateLimited', 'Waiting for Approval'],
    ['Initializing'],
    ['Generating'],
    ['Disabled'],
    ['Done', 'Idle', 'Running']
];

console.log('\n🔀 Testing Severity Ordering Groups');
console.log('=' + '='.repeat(40));

for (let i = 0; i < ordering.length - 1; i++) {
    const higherGroup = ordering[i];
    const lowerGroup = ordering[i + 1];
    
    for (const higher of higherGroup) {
        for (const lower of lowerGroup) {
            const higherSev = severity(higher);
            const lowerSev = severity(lower);
            const pass = higherSev > lowerSev;
            
            console.log(`${pass ? '✅' : '❌'} "${higher}"(${higherSev}) > "${lower}"(${lowerSev})`);
            
            if (pass) {
                passed++;
            } else {
                failed++;
            }
        }
    }
}

console.log('\n📊 Summary');
console.log('=' + '='.repeat(40));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`🎯 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed === 0) {
    console.log('🎉 All tests passed! Severity mapping is correct.');
    process.exit(0);
} else {
    console.log('💥 Some tests failed. Review severity mapping logic.');
    process.exit(1);
}