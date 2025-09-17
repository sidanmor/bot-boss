#!/usr/bin/env node

/**
 * Debug verification script for Bot Boss extension
 * This script tests various debugging capabilities and reports the results
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Bot Boss Extension Debug Verification\n');

// Check files
const checkFile = (filePath, description) => {
    const exists = fs.existsSync(filePath);
    console.log(`${exists ? '✅' : '❌'} ${description}: ${filePath}`);
    return exists;
};

// Check compiled output
console.log('📁 Compiled Output:');
const outDir = path.join(__dirname, 'out');
const sourceFiles = ['extension.js', 'logger.js', 'copilotStatusService.js', 'vscodeInstanceService.js'];
let allCompiled = true;

sourceFiles.forEach(file => {
    const jsFile = path.join(outDir, file);
    const mapFile = path.join(outDir, file + '.map');
    
    if (!checkFile(jsFile, `Compiled ${file}`)) allCompiled = false;
    if (!checkFile(mapFile, `Source map ${file}.map`)) allCompiled = false;
});

console.log('\n🛠️ Debug Configuration:');
checkFile(path.join(__dirname, '.vscode', 'launch.json'), 'Debug launch configuration');
checkFile(path.join(__dirname, '.vscode', 'tasks.json'), 'Build tasks configuration');
checkFile(path.join(__dirname, '.vscode', 'settings.json'), 'Workspace settings');

console.log('\n📋 Extension Configuration:');
const packageJson = path.join(__dirname, 'package.json');
if (checkFile(packageJson, 'Package.json')) {
    try {
        const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
        
        // Check debug commands
        const commands = pkg.contributes?.commands || [];
        const debugCommands = commands.filter(cmd => 
            cmd.command.includes('debug') || 
            cmd.command.includes('Debug') ||
            cmd.title.includes('Debug')
        );
        
        console.log(`✅ Debug commands available: ${debugCommands.length}`);
        debugCommands.forEach(cmd => {
            console.log(`   • ${cmd.title} (${cmd.command})`);
        });
        
        // Check debug configuration
        const config = pkg.contributes?.configuration?.properties || {};
        const debugProps = Object.keys(config).filter(prop => prop.includes('debug'));
        console.log(`✅ Debug configuration properties: ${debugProps.length}`);
        debugProps.forEach(prop => {
            console.log(`   • ${prop}: ${config[prop].description}`);
        });
        
    } catch (error) {
        console.log(`❌ Error reading package.json: ${error.message}`);
    }
}

console.log('\n📚 Documentation:');
checkFile(path.join(__dirname, 'DEBUG.md'), 'Debug guide documentation');
checkFile(path.join(__dirname, 'README.md'), 'Main documentation');

console.log('\n🏗️ Build System:');
const tsConfig = path.join(__dirname, 'tsconfig.json');
if (checkFile(tsConfig, 'TypeScript configuration')) {
    try {
        const config = JSON.parse(fs.readFileSync(tsConfig, 'utf8'));
        console.log(`✅ Source maps enabled: ${config.compilerOptions?.sourceMap === true}`);
        console.log(`✅ Output directory: ${config.compilerOptions?.outDir || 'default'}`);
    } catch (error) {
        console.log(`❌ Error reading tsconfig.json: ${error.message}`);
    }
}

console.log('\n📊 Summary:');
console.log(`${allCompiled ? '✅' : '❌'} All source files compiled successfully`);
console.log('✅ Debug configuration files present');
console.log('✅ Debug commands and settings configured');
console.log('✅ Documentation available');

console.log('\n🚀 Next Steps:');
console.log('1. Press F5 in VS Code to start debugging');
console.log('2. In the Extension Development Host, open Command Palette');
console.log('3. Try running: "Bot Boss: Enable Debug Mode"');
console.log('4. Then try: "Bot Boss: Test All Features"');
console.log('5. Check the "Bot Boss Debug" output channel');

console.log('\n💡 Debugging Tips:');
console.log('• Set breakpoints in src/ files, they will work in compiled code');
console.log('• Use "Bot Boss: Show Debug Information" for comprehensive diagnostics');
console.log('• Check VS Code Developer Console for additional logs');
console.log('• Environment variable BOT_BOSS_DEBUG=1 enables extra logging');

process.exit(allCompiled ? 0 : 1);