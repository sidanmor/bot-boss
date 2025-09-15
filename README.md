# Bot Boss - VS Code Instance Manager

A VS Code extension that helps you manage and monitor all your open VS Code instances from within VS Code.

## Features

- **List All VS Code Instances**: See all running VS Code processes with detailed information
- **Workspace Detection**: Automatically detects which workspace/folder each instance has open
- **Performance Monitoring**: View memory usage, CPU usage, and uptime for each instance
- **Quick Focus**: Click to bring any VS Code window to the foreground
- **Detailed Information**: View command line arguments and process details
- **Auto-refresh**: Automatically updates the list every 30 seconds

## How to Use

1. Install the extension
2. Open the "Bot Boss" view in the Activity Bar (sidebar)
3. Expand "VS Code Instances" to see all running instances
4. Right-click on any instance to:
   - Focus the window
   - View detailed workspace information
5. Click the refresh button to manually update the list

## Features in Detail

### Instance Detection
The extension detects VS Code instances by scanning for `Code.exe` processes and extracts:
- Process ID (PID)
- Workspace/folder path
- Memory usage
- CPU usage
- Uptime
- Command line arguments

### Window Management
- **Focus Instance**: Brings the selected VS Code window to the foreground
- **Workspace Info**: Opens a detailed view of the instance's configuration

## System Requirements

- Windows OS (currently Windows-specific due to PowerShell dependencies)
- VS Code 1.74.0 or higher

## Installation

1. Download the `.vsix` file
2. In VS Code, go to Extensions view
3. Click the "..." menu and select "Install from VSIX..."
4. Select the downloaded `.vsix` file

## Development

To build from source:

```bash
npm install
npm run compile
npx vsce package
```

## Known Limitations

- Currently Windows-only (uses PowerShell and Windows-specific APIs)
- Requires administrative permissions for some process information
- May not detect all VS Code instances if they're running with different permissions

## Future Enhancements

- Cross-platform support (macOS, Linux)
- Ability to close instances
- Workspace switching
- Performance graphs
- Instance grouping by workspace

## License

[Add your license here]