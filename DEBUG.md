# Bot Boss Extension - Debugging Guide

## Quick Start Debugging

### 1. Enable Debug Mode
1. Open Command Palette (`Ctrl+Shift+P`)
2. Run: `Bot Boss: Enable Debug Mode`
3. This will enable debug logging and show the output panel

### 2. Start Debugging Session
1. Press `F5` or go to Run and Debug view
2. Select "Run Extension" configuration
3. This will launch a new VS Code window with your extension loaded

### 3. View Debug Information
- **Debug Output**: View → Output → Select "Bot Boss Debug"
- **Developer Console**: Help → Toggle Developer Tools → Console tab
- **Extension Logs**: Use the debug commands in Command Palette

## Debug Commands Available

| Command | Description |
|---------|-------------|
| `Bot Boss: Show Debug Information` | Comprehensive debug info report |
| `Bot Boss: Enable Debug Mode` | Enable debug logging |
| `Bot Boss: Clear Debug Log` | Clear the debug output |
| `Bot Boss: Debug Extension Host Info` | VS Code environment details |
| `Bot Boss: Test All Features` | Run comprehensive feature tests |
| `Bot Boss: Debug Copilot Raw Status` | Raw Copilot extension status |
| `Bot Boss: Debug Copilot Chat Monitoring` | Chat monitoring diagnostics |
| `Bot Boss: Debug Instance Detection` | VS Code instance detection |

## Configuration

Set these in your VS Code settings (`Ctrl+,`) or workspace settings:

```json
{
    "bot-boss.debug.enabled": true,
    "bot-boss.debug.logLevel": "debug",
    "bot-boss.debug.showOutput": true
}
```

Or use environment variable before starting VS Code:
```bash
export BOT_BOSS_DEBUG=1
# or on Windows:
set BOT_BOSS_DEBUG=1
```

## Debugging Scenarios

### Extension Not Loading
1. Check VS Code Developer Console for errors
2. Run `Bot Boss: Debug Extension Host Info`
3. Verify in Extensions view that Bot Boss is enabled

### Instance Detection Issues
1. Run `Bot Boss: Debug Instance Detection`
2. Check if shared file exists and is accessible
3. Run `Bot Boss: Show Shared File Status`

### Copilot Status Problems
1. Run `Bot Boss: Debug Copilot Raw Status`
2. Run `Bot Boss: Debug Copilot Chat Monitoring`
3. Check if Copilot extension is installed and active

### Performance Issues
1. Enable debug mode to see timing information
2. Check memory usage in debug output
3. Run `Bot Boss: Test All Features` to identify bottlenecks

## Breakpoint Debugging

### Setting Breakpoints
1. Open source files in `src/` folder
2. Click in gutter to set breakpoints
3. Press `F5` to start debugging
4. Use debugging extension in new window to trigger breakpoints

### Useful Breakpoint Locations
- `src/extension.ts` - `activate()` function
- `src/copilotStatusService.ts` - `pollOnce()` method
- `src/vscodeInstanceService.ts` - `getVSCodeInstances()` method
- `src/sharedInstanceManager.ts` - `registerCurrentInstance()` method

## Common Issues

### TypeScript Compilation Errors
```bash
npm run compile
```

### Extension Not Recognized
- Restart VS Code Extension Development Host
- Check package.json activation events
- Verify main entry point exists

### Debug Output Not Showing
1. View → Output → Select "Bot Boss Debug"
2. Run `Bot Boss: Enable Debug Mode`
3. Check console.log statements in Developer Tools

## Log Levels

- **DEBUG**: Detailed execution flow, method entry/exit
- **INFO**: General information, status changes
- **WARN**: Potential issues, deprecated usage
- **ERROR**: Errors that don't crash the extension

## Advanced Debugging

### Attach Debugger
1. Start extension with `--inspect-extensions=5870`
2. Use "Attach to Extension Host" configuration
3. Connect external debugger

### Performance Profiling
1. Open Developer Tools in Extension Development Host
2. Go to Performance tab
3. Record while using extension features

### Memory Analysis
1. Check process memory in debug output
2. Use heap snapshots in Developer Tools
3. Monitor for memory leaks during long runs

## Getting Help

1. Check debug output first: `Bot Boss: Show Debug Information`
2. Run feature tests: `Bot Boss: Test All Features`
3. Enable debug mode and reproduce issue
4. Copy relevant logs from Bot Boss Debug output channel